import { GitHubIcon } from './icons';

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <a href="https://signoff-ui.vercel.app" className="brand">
          <Logo />
          <span className="brand-name">signoff-ui</span>
        </a>
        <span className="header-divider" aria-hidden="true">
          /
        </span>
        <span className="header-title">Coding agent</span>
        <nav aria-label="Links" className="header-links">
          <a href="https://signoff-ui.vercel.app/docs" className="header-link">
            Docs
          </a>
          <a
            href="https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent"
            className="icon-button"
            aria-label="This app's source on GitHub"
          >
            <GitHubIcon />
          </a>
        </nav>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#181c22" stroke="#262b33" />
      <path d="M11 9v14" stroke="#353c47" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="9" r="2.6" fill="#22d3ee" />
      <circle cx="11" cy="16" r="2.6" fill="#67e8f9" />
      <circle cx="11" cy="23" r="2.6" fill="#f0468a" />
      <path d="M17 9h7M17 16h5M17 23h7" stroke="#e8eaed" strokeWidth="2" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}
