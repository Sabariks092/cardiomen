/** Kept in memory only, never stored or put in a route, between the register and verify screens. */
let password: string | null = null;

export function rememberSignupPassword(value: string) {
  password = value;
}

export function signupPassword() {
  return password;
}

export function forgetSignupPassword() {
  password = null;
}
