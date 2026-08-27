import { getChatGPTUser } from "./chatgpt-auth";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <Workspace displayName={user?.displayName ?? "创作者"} />;
}
