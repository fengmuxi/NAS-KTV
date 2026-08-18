import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import Songs from '../pages/Songs';
import Scan from '../pages/Scan';
import Dedup from '../pages/Dedup';
import Artists from '../pages/Artists';
import Categories from '../pages/Categories';
import Devices from '../pages/Devices';
import AiParse from '../pages/AiParse';
import Separation from '../pages/Separation';
import Settings from '../pages/Settings';
import GpuManage from '../pages/GpuManage';
import Logs from '../pages/Logs';
import Download from '../pages/Download';

export const router = createBrowserRouter(
  [
    {
      path: '/login',
      element: <Login />,
    },
    {
      element: (
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      ),
      children: [
        { path: '/', element: <Dashboard /> },
        { path: '/songs', element: <Songs /> },
        { path: '/scan', element: <Scan /> },
        { path: '/dedup', element: <Dedup /> },
        { path: '/artists', element: <Artists /> },
        { path: '/categories', element: <Categories /> },
        { path: '/devices', element: <Devices /> },
        { path: '/ai-parse', element: <AiParse /> },
        { path: '/separation', element: <Separation /> },
        { path: '/gpu', element: <GpuManage /> },
        { path: '/logs', element: <Logs /> },
        { path: '/settings', element: <Settings /> },
        { path: '/download', element: <Download /> },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
  { basename: '/admin/' },
);
