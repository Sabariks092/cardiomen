import { Alert } from 'react-native';

/** react-native-web's Alert does nothing, so web builds use the browser's own dialogs. */
Alert.alert = (title, message, buttons) => {
  const text = [title, message].filter(Boolean).join('\n\n');
  const cancel = buttons?.find((button) => button.style === 'cancel');
  const action = buttons?.find((button) => button.style !== 'cancel');
  if (!cancel) {
    window.alert(text);
    action?.onPress?.();
  } else if (window.confirm(text)) {
    action?.onPress?.();
  } else {
    cancel.onPress?.();
  }
};
