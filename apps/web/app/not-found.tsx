import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-muted-foreground">The link may be broken, or the campaign hasn&apos;t been created yet.</p>
      <Link href="/" className={buttonVariants()}>
        Back to ClipPool
      </Link>
    </div>
  );
}
