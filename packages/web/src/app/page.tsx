import { redirect } from "next/navigation";

/** 根路径直接进入遥测中枢 */
export default function HomePage() {
  redirect("/dashboard");
}
