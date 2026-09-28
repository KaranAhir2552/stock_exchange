import { redirect } from "next/navigation";

// ponytail: the Dashboard screen (01) comes after the core pages; Swap is the home page until then.
export default function Home() {
  redirect("/swap");
}
