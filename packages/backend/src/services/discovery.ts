import dgram from 'dgram';
import os from 'os';
import logger from '../logger';
import { config } from '../config';

// 局域网发现端口：TV 端监听同一端口接收广播
const DISCOVERY_PORT = 45678;
const BROADCAST_INTERVAL_MS = 5000;

let socket: dgram.Socket | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * 获取本机第一个局域网 IPv4 地址及子网掩码（用于拼装局域网可达的服务地址、
 * 计算子网定向广播地址）。过滤 WSL/Docker 内网（172.16–31.x），优先 192.168.x / 10.x。
 */
function getLocalIPv4(): { address: string; netmask: string } | null {
  const ifaces = os.networkInterfaces();
  let fallback: { address: string; netmask: string } | null = null;
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const netmask = iface.netmask ?? '255.255.255.0';
      const octets = iface.address.split('.').map(Number);
      // 过滤 WSL / Docker 内网段（172.16.0.0 – 172.31.255.255）
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) continue;
      // 优先 192.168.x（家庭局域网最常见）
      if (octets[0] === 192 && octets[1] === 168) return { address: iface.address, netmask };
      // 其次 10.x
      if (octets[0] === 10) return { address: iface.address, netmask };
      // 其余保留作为 fallback
      if (!fallback) fallback = { address: iface.address, netmask };
    }
  }
  return fallback;
}

/**
 * 根据 IPv4 地址与子网掩码计算子网定向广播地址（如 192.168.1.50/24 → 192.168.1.255）。
 * 子网定向广播比受限广播 255.255.255.255 兼容性更好：部分 Android 设备/ROM 不会把受限
 * 广播包递交给应用层 socket，但一定会接收子网定向广播，故 TV 端（尤其 Android TV）的
 * 自动扫描更可靠。桌面与多数 Linux 两种广播都能收到。
 */
function getSubnetBroadcast(address: string, netmask: string): string | null {
  const ip = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  if (ip.length !== 4 || mask.length !== 4) return null;
  const bc = ip.map((p, i) => (p | (~mask[i] & 255)) & 255);
  return bc.join('.');
}

/**
 * 启动 UDP 局域网发现广播：周期性向 255.255.255.255:45678 广播服务信息，
 * 供 TV 端自动扫描局域网内的后端服务（幂等，重复调用直接返回）。
 */
export function startDiscoveryBroadcast(): void {
  if (timer) {
    return;
  }

  socket = dgram.createSocket('udp4');
  socket.on('error', (err) => {
    logger.warn({ err }, 'UDP discovery socket error');
  });
  socket.bind(() => {
    socket?.setBroadcast(true);
  });

  const broadcast = () => {
    const info = getLocalIPv4();
    if (!info) {
      return;
    }
    const { address, netmask } = info;
    const payload = Buffer.from(
      JSON.stringify({
        service: 'nasktv-backend',
        name: 'NASKTV',
        apiBaseUrl: `http://${address}:${config.port}`,
        wsUrl: `ws://${address}:${config.port}`,
      }),
    );
    // 同时发「受限广播 255.255.255.255」与「子网定向广播」，最大化各 OS/ROM 的接收面：
    // 桌面与多数 Linux 收受限广播；部分 Android 只收子网定向广播。
    const targets = new Set<string>(['255.255.255.255']);
    const subnet = getSubnetBroadcast(address, netmask);
    if (subnet) targets.add(subnet);
    for (const target of targets) {
      socket?.send(payload, DISCOVERY_PORT, target, (err) => {
        if (err) {
          logger.warn({ err, target }, 'UDP discovery broadcast failed');
        }
      });
    }
  };

  broadcast();
  timer = setInterval(broadcast, BROADCAST_INTERVAL_MS);
  logger.info(`UDP discovery broadcast started on port ${DISCOVERY_PORT}`);
}
