#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
// 局域网发现：后端向 255.255.255.255:45678 周期性广播服务信息，TV 端监听同一端口
const DISCOVERY_PORT: u16 = 45678;
const DISCOVERY_FRESH_SECS: u64 = 15;

// 配置服务：手机扫码打开 http://<TV-IP>:45678/p 输入后端地址，POST 回 TV 保存
const CONFIG_HTTP_PORT: u16 = 45678;

static DISCOVERY_RUNNING: AtomicBool = AtomicBool::new(false);
static CONFIG_SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// 后端 UDP 广播包（service 字段用于过滤非 NASKTV 广播）
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiscoveredServer {
  service: String,
  name: String,
  api_base_url: String,
  ws_url: String,
}

/// 返回给前端 JS 的发现结果。
/// 注意：字段序列化为 `apiUrl`（与 TV 端 BackendConfig / 手机配置页 POST 体 `apiUrl` 命名一致），
/// 而非后端广播里的 `apiBaseUrl`。前端 Setup 页与手机配置页均按 `apiUrl` 读取；
/// 若此处输出 `apiBaseUrl`，前端拿到的是 undefined，点击扫描结果会「无法连接」。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiscoveredServerView {
  name: String,
  api_url: String,
  ws_url: String,
}

/// 最近发现的服务器列表（含最后收到时间，用于过期清理）
struct DiscoveryState {
  servers: Arc<Mutex<Vec<(DiscoveredServer, u64)>>>,
}

/// 手机配置页 POST 的请求体
#[derive(Deserialize)]
struct ConfigPayload {
  #[serde(rename = "apiUrl")]
  api_url: String,
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

/// 启动 UDP 发现监听（幂等）：接收后端广播并维护最近发现列表
#[tauri::command]
fn start_discovery(state: State<'_, DiscoveryState>) -> Result<(), String> {
  if DISCOVERY_RUNNING.swap(true, Ordering::SeqCst) {
    return Ok(());
  }
  let socket = UdpSocket::bind(format!("0.0.0.0:{DISCOVERY_PORT}"))
    .map_err(|e| format!("Failed to bind UDP {DISCOVERY_PORT}: {e}"))?;
  socket
    .set_read_timeout(Some(Duration::from_millis(1000)))
    .map_err(|e| e.to_string())?;

  let servers = state.servers.clone();
  std::thread::spawn(move || {
    let mut buf = [0u8; 2048];
    loop {
      match socket.recv_from(&mut buf) {
        Ok((len, _)) => {
          let text = String::from_utf8_lossy(&buf[..len]).to_string();
          if let Ok(server) = serde_json::from_str::<DiscoveredServer>(&text) {
            if server.service == "nasktv-backend" {
              let mut list = servers.lock().unwrap();
              if let Some(entry) = list
                .iter_mut()
                .find(|(s, _)| s.api_base_url == server.api_base_url)
              {
                entry.1 = now_secs();
              } else {
                list.push((server, now_secs()));
              }
            }
          }
        }
        Err(_) => {}
      }
    }
  });
  Ok(())
}

/// 收集最近发现的服务器列表（超过 15 秒未收到广播的自动过滤）
fn collect_servers(state: &State<'_, DiscoveryState>) -> Vec<DiscoveredServerView> {
  let now = now_secs();
  let mut servers = state.servers.lock().unwrap();
  servers.retain(|(_, ts)| now.saturating_sub(*ts) < DISCOVERY_FRESH_SECS);
  servers
    .iter()
    .map(|(s, _)| DiscoveredServerView {
      name: s.name.clone(),
      api_url: s.api_base_url.clone(),
      ws_url: s.ws_url.clone(),
    })
    .collect()
}

/// 获取最近发现的服务器列表（超过 15 秒未收到广播的自动过滤）
#[tauri::command]
fn get_discovered_servers(state: State<'_, DiscoveryState>) -> Vec<DiscoveredServerView> {
  collect_servers(&state)
}

/// 启动手机配置 HTTP 服务（幂等）：
/// - GET /p 返回内嵌配置页（手机扫码打开）
/// - POST /p { apiUrl } 通过 tauri 事件 nasktv:config-received 通知前端保存
#[tauri::command]
fn start_config_server(app: AppHandle, state: State<'_, DiscoveryState>) -> Result<(), String> {
  if CONFIG_SERVER_RUNNING.swap(true, Ordering::SeqCst) {
    return Ok(());
  }
  let server = tiny_http::Server::http(format!("0.0.0.0:{CONFIG_HTTP_PORT}"))
    .map_err(|e| format!("Failed to start config server on {CONFIG_HTTP_PORT}: {e}"))?;
  let servers = state.servers.clone();

  std::thread::spawn(move || {
    for mut request in server.incoming_requests() {
      // 局域网发现列表：手机配置页拉取 TV 已发现的后端，列举供选择
      if request.url() == "/servers" {
        let now = now_secs();
        let mut list = servers.lock().unwrap();
        list.retain(|(_, ts)| now.saturating_sub(*ts) < DISCOVERY_FRESH_SECS);
        let views: Vec<DiscoveredServerView> = list
          .iter()
          .map(|(s, _)| DiscoveredServerView {
            name: s.name.clone(),
            api_url: s.api_base_url.clone(),
            ws_url: s.ws_url.clone(),
          })
          .collect();
        drop(list);
        let body = serde_json::to_string(&views).unwrap_or_else(|_| "[]".to_string());
        let _ = request.respond(
          tiny_http::Response::from_string(body)
            .with_header(
              tiny_http::Header::from_bytes(
                &b"Content-Type"[..],
                &b"application/json; charset=utf-8"[..],
              )
              .unwrap(),
            )
            .with_status_code(200),
        );
        continue;
      }
      if request.url() != "/p" {
        let _ = request.respond(
          tiny_http::Response::from_string("404").with_status_code(404),
        );
        continue;
      }

      if request.method() == &tiny_http::Method::Post {
        let mut body = String::new();
        let mut rejected = true;
        if request.as_reader().read_to_string(&mut body).is_ok() {
          if let Ok(payload) = serde_json::from_str::<ConfigPayload>(&body) {
            let api_url = payload.api_url.trim().to_string();
            if !api_url.is_empty() {
              rejected = false;
              let _ = app.emit("nasktv:config-received", api_url);
            }
          }
        }
        let (body, code) = if rejected {
          ("{\"success\":false}".to_string(), 400)
        } else {
          ("{\"success\":true}".to_string(), 200)
        };
        let _ = request.respond(
          tiny_http::Response::from_string(body)
            .with_status_code(code)
            .with_header(
              tiny_http::Header::from_bytes(
                &b"Content-Type"[..],
                &b"application/json; charset=utf-8"[..],
              )
              .unwrap(),
            ),
        );
        continue;
      }

      let html = include_str!("../config-page.html");
      let _ = request.respond(
        tiny_http::Response::from_string(html).with_header(
          tiny_http::Header::from_bytes(
            &b"Content-Type"[..],
            &b"text/html; charset=utf-8"[..],
          )
          .unwrap(),
        ),
      );
    }
  });
  Ok(())
}

/// 枚举本机非回环 IPv4 地址（二维码 URL 前缀用）。
/// 过滤 WSL/Docker 内网（172.16–31.x），优先 192.168.x / 10.x 局域网地址。
/// 部分 Android 设备 getifaddrs 枚举为空，回退用 UDP connect 获取出口 IP（不实际发包）。
#[tauri::command]
fn get_local_ips() -> Result<Vec<String>, String> {
  let mut ips: Vec<String> = Vec::new();
  if let Ok(ifaddrs) = if_addrs::get_if_addrs() {
    for iface in ifaddrs {
      if iface.is_loopback() {
        continue;
      }
      if let if_addrs::IfAddr::V4(v4) = iface.addr {
        let ip = v4.ip;
        let octets = ip.octets();
        // 过滤 WSL / Docker 内网段（172.16.0.0 – 172.31.255.255）
        if octets[0] == 172 && (16..=31).contains(&octets[1]) {
          continue;
        }
        ips.push(ip.to_string());
      }
    }
  }

  // 回退：枚举不到接口时，用 UDP connect 获取出口 IP（不实际发包）
  if ips.is_empty() {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
      if socket.connect("8.8.8.8:80").is_ok() {
        if let Ok(local) = socket.local_addr() {
          if let std::net::IpAddr::V4(v4) = local.ip() {
            let octets = v4.octets();
            if !(octets[0] == 172 && (16..=31).contains(&octets[1])) {
              ips.push(v4.to_string());
            }
          }
        }
      }
    }
  }

  // 排序：优先 192.168.x.x（最常见家庭局域网），再 10.x.x.x，其余排最后
  ips.sort_by(|a, b| {
    let priority = |ip: &str| -> u8 {
      if ip.starts_with("192.168.") { 0 }
      else if ip.starts_with("10.") { 1 }
      else { 2 }
    };
    priority(a).cmp(&priority(b))
  });
  ips.dedup();
  if ips.is_empty() {
    Err("无法获取本机 IP 地址".to_string())
  } else {
    Ok(ips)
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .manage(DiscoveryState {
      servers: Arc::new(Mutex::new(Vec::new())),
    })
    .invoke_handler(tauri::generate_handler![
      start_discovery,
      get_discovered_servers,
      start_config_server,
      get_local_ips,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
