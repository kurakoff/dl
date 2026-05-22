const ACCOUNTS_KEY = 'auth_accounts';
const TOKEN_KEY = 'auth_token';

export function getAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [];
  } catch {
    return [];
  }
}

export function addAccount({ userId, email, name, picture, token }) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.userId === userId);
  const entry = { userId, email, name, picture, token };
  if (idx >= 0) {
    accounts[idx] = entry;
  } else {
    accounts.push(entry);
  }
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  localStorage.setItem(TOKEN_KEY, token);
}

export function switchAccount(userId) {
  const accounts = getAccounts();
  const target = accounts.find(a => a.userId === userId);
  if (target) {
    localStorage.setItem(TOKEN_KEY, target.token);
  }
}

// Returns 'switched' | 'none_left'
export function removeAccount(userId) {
  const accounts = getAccounts();
  const currentToken = localStorage.getItem(TOKEN_KEY);
  const removed = accounts.find(a => a.userId === userId);
  const remaining = accounts.filter(a => a.userId !== userId);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(remaining));

  if (removed && removed.token === currentToken) {
    if (remaining.length > 0) {
      localStorage.setItem(TOKEN_KEY, remaining[0].token);
      return 'switched';
    }
    localStorage.removeItem(TOKEN_KEY);
    return 'none_left';
  }
  return remaining.length > 0 ? 'switched' : 'none_left';
}

// Returns 'switched' | 'none_left'
export function removeAccountByToken(token) {
  const accounts = getAccounts();
  const target = accounts.find(a => a.token === token);
  if (target) return removeAccount(target.userId);
  // Token not in accounts list — legacy fallback
  localStorage.removeItem(TOKEN_KEY);
  return 'none_left';
}

export function removeAllAccounts() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNTS_KEY);
}

export function getOtherAccounts() {
  const currentToken = localStorage.getItem(TOKEN_KEY);
  return getAccounts().filter(a => a.token !== currentToken);
}
