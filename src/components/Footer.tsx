'use client';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="shrink-0 w-full"
      style={{
        borderTop: '1px solid var(--border1)',
        background: 'var(--surface)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div className="flex items-center justify-between px-6 py-2.5 gap-4 flex-wrap">
        {/* Left: brand */}
        <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
          © {currentYear} PacificaLens. All rights reserved.
        </span>

        {/* Right: links */}
        <div className="flex items-center gap-5">
          <a
            href="https://docs.pacificalens.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] transition-colors duration-150 hover:text-accent"
            style={{ color: 'var(--text3)' }}
          >
            Docs
          </a>
          <a
            href="https://docs.pacificalens.xyz/terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] transition-colors duration-150 hover:text-accent"
            style={{ color: 'var(--text3)' }}
          >
            Terms of Service
          </a>
          <a
            href="https://docs.pacificalens.xyz/untitled-page"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] transition-colors duration-150 hover:text-accent"
            style={{ color: 'var(--text3)' }}
          >
            Privacy Policy
          </a>
          <a
            href="https://x.com/pacificalens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] transition-colors duration-150 hover:text-accent flex items-center gap-1"
            style={{ color: 'var(--text3)' }}
            aria-label="X / Twitter"
          >
            {/* X (Twitter) icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
            <span>@pacificalens</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
