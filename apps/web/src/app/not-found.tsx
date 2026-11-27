import Link from 'next/link';

// Structure only, visual design pending. Rendered for unknown URLs and by `notFound()`.
export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p>There is nothing at this address.</p>
      <Link href="/">Back to the start</Link>
    </main>
  );
}
