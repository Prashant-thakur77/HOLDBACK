import Link from 'next/link';

import { BoxStamp } from '@/components/art/Stamps';

/**
 * Rendered for unknown URLs and by `notFound()`. Set as an undelivered slip:
 * the address did not exist, so here are the ways back in.
 */
export default function NotFound() {
  return (
    <main className="wrap lost">
      <div>
        <p className="lost__code" aria-hidden="true">
          4<span className="wordmark__o" />4
        </p>
        <h1 className="h2">Nothing at this address</h1>
        <p className="lost__stamp">
          <BoxStamp
            text="Unknown address"
            ink="red"
            rotate={-4}
            size={60}
            className="stamp--struck"
          />
        </p>
        <p className="lead">
          The page, hold or run you asked for does not exist here. If you followed a receipt link,
          check the address: a hold address is 32 to 44 characters.
        </p>
        <div className="btn-row lost__links">
          <Link href="/" className="btn">
            Back to the front page
          </Link>
          <Link href="/docs" className="btn btn--ghost">
            Docs and questions
          </Link>
        </div>
      </div>
    </main>
  );
}
