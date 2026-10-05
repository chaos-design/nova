import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 路由全部类型化：<Link href> 只接受真实存在的路由字符串
  typedRoutes: true,
};

export default nextConfig;
