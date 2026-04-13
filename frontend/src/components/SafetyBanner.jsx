export default function SafetyBanner({ threatCount, onShowThreats, onDismiss }) {
  if (!threatCount) return null;

  return (
    <div className="flex items-center justify-between px-6 py-2.5 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span className="text-sm font-medium text-red-700 dark:text-red-300">
          {threatCount} сайт{threatCount === 1 ? '' : threatCount < 5 ? 'а' : 'ов'} с угрозами безопасности!
        </span>
        <button
          onClick={onShowThreats}
          className="text-sm font-medium text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-200 transition"
        >
          Показать
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-200 transition text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}
