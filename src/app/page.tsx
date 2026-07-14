import { redirect } from "next/navigation";

/** Entry point — send visitors to the dashboard (auth guard lives there). */
export default function Home() {
  redirect("/dashboard");
}
