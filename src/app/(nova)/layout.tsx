import { AppShell } from "@/components/layout/app-shell";

/** `(nova)` 路由组共享控制台外壳 */
export default function NovaLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
