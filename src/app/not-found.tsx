import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-16 font-semibold">Page not found</h1>
      <Link href="/" className="mt-3 inline-block text-13 text-link hover:underline">Back to the overview</Link>
    </div>
  );
}
