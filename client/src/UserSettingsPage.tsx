import { X } from 'lucide-react';
import type { HomePage } from './homePage';

const HOME_PAGE_OPTIONS: { value: HomePage; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'reports', label: 'Reports' },
  { value: 'favorites', label: 'Favorites' },
];

// User-facing settings drawer (opened from the topbar gear icon). Holds the
// per-user configurable options such as the default home page. Additional
// user preferences will be added here later.
export function UserSettingsPage({
  homePage,
  onChangeHomePage,
  onClose,
}: {
  homePage: HomePage;
  onChangeHomePage: (page: HomePage) => void;
  onClose: () => void;
}) {
  const activeIndex = Math.max(0, HOME_PAGE_OPTIONS.findIndex((option) => option.value === homePage));

  return <div className="record-drawer" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="record-title">
      <div>
        <p className="eyebrow">Preferences</p>
        <h3>Settings</h3>
      </div>
      <div className="record-title-actions"><button className="icon-button" onClick={onClose} aria-label="Close settings" title="Close settings"><X size={17} /></button></div>
    </div>
    <div className="settings-panel">
      <div className="settings-form-row">
        <div className="settings-field">
          <span className="settings-label">Default home page</span>
          <div className="home-page-slider" role="radiogroup" aria-label="Default home page">
            <span className="home-page-slider-thumb" style={{ transform: `translateX(${activeIndex * 100}%)` }} aria-hidden="true" />
            {HOME_PAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={homePage === option.value}
                className={`home-page-slider-option ${homePage === option.value ? 'active' : ''}`}
                onClick={() => onChangeHomePage(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="settings-hint">Choose the page you land on after signing in.</p>
    </div>
  </div>;
}
