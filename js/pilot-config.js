// TezkorIsh real pilot konfiguratsiyasi
// Tavsiya: frontend va backendni bitta origin (same-origin) da ishlating.
window.TEZKOR_PILOT_CONFIG = window.TEZKOR_PILOT_CONFIG || {
  pilotMode: 'server',
  apiBaseUrl: '/api',
  allowLocalFallback: false,
  telegram: {
    botUsername: '',
    loginUrl: '',
    widgetCallbackUrl: '/api/auth/telegram/callback',
    deepLinkUrl: '',
    loginButtonText: 'Telegram orqali kirish',
    callbackKeys: {
      id: ['telegram_user_id', 'tg_user_id', 'id'],
      username: ['telegram_username', 'tg_username', 'username'],
      firstName: ['first_name', 'tg_first_name', 'telegram_first_name'],
      lastName: ['last_name', 'tg_last_name', 'telegram_last_name'],
      photoUrl: ['photo_url', 'tg_photo_url', 'telegram_photo_url'],
      verified: ['tg_verified', 'telegram_verified']
    }
  }
};
