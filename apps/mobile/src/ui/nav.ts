import { Href, useRouter } from 'expo-router';

/** Clears the stack first, so Back can't return to sign-in screens or pile up copies of Home. */
export function resetTo(router: ReturnType<typeof useRouter>, href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
