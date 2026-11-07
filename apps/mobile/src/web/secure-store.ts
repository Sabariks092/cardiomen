/** expo-secure-store has no web version. localStorage is not encrypted, so this is for local previews only. */
export async function getItemAsync(key: string) {
  return localStorage.getItem(key);
}

export async function setItemAsync(key: string, value: string) {
  localStorage.setItem(key, value);
}

export async function deleteItemAsync(key: string) {
  localStorage.removeItem(key);
}
