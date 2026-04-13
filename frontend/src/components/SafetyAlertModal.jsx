function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace('sc-domain:', '');
}

const THREAT_LABELS = {
  MALWARE: 'Malware',
  SOCIAL_ENGINEERING: 'Phishing / Social Engineering',
  UNWANTED_SOFTWARE: 'Unwanted Software',
  POTENTIALLY_HARMFUL_APPLICATION: 'Potentially Harmful App',
};

export default function SafetyAlertModal({ threats, onShowThreats, onClose }) {
  if (!threats || threats.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col items-center pt-6 pb-4 px-6">
          <div className="w-14 h-14 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-3">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.618 5.984A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Обнаружены угрозы безопасности!
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Google Safe Browsing обнаружил проблемы на {threats.length} сайт{threats.length === 1 ? 'е' : threats.length < 5 ? 'ах' : 'ах'}
          </p>
        </div>

        {/* Threat list */}
        <div className="px-6 pb-4 max-h-60 overflow-y-auto">
          {threats.map((t, i) => (
            <div key={i} className="flex items-start gap-3 py-2 border-t border-gray-100 dark:border-gray-700 first:border-0">
              <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {shortUrl(t.siteUrl)}
                </p>
                <p className="text-xs text-red-500">
                  {t.threatTypes.split(',').map(tt => THREAT_LABELS[tt] || tt).join(', ')}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onShowThreats}
            className="flex-1 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition"
          >
            Показать угрозы
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
