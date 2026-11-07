import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/ui/theme';

/** MapLibre React Native has no web version, so web builds show this in place of the map. */
export function Map({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center' }, style, { backgroundColor: colors.fieldBg }]}>
      <Text style={{ color: colors.white, opacity: 0.5 }}>Map is only available in the mobile app</Text>
    </View>
  );
}

export const Camera = () => null;
export const GeoJSONSource = () => null;
export const Layer = () => null;

export const StaticMapImageManager = {
  createImage: async () => {
    throw new Error('Map images are only available in the mobile app.');
  },
};
