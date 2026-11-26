import {
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import type { SystemColors } from "../../systemColors";
import type { ProfileStyles } from "./ProfileScreen";
import { useProfilePhotoUrls } from "./useProfilePhotoUrls";

export function ProfilePhotoGrid({
  photos,
  styles,
  onOpenPhoto,
  onEditPhotos,
}: {
  photos: string[];
  styles: ProfileStyles;
  onOpenPhoto: (index: number, photoUrls: string[]) => void;
  onEditPhotos: () => void;
}) {
  const visiblePhotos = photos.slice(0, 3);
  const { urls, error } = useProfilePhotoUrls(photos);
  const resolvedPhotos = photos.map((photo, index) => urls[index] ?? photo);
  return (
    <View>
      <View style={styles.photoGrid}>
        <PhotoTile
          uri={resolvedPhotos[0]}
          label={visiblePhotos[0] ? undefined : "Add photos"}
          styles={styles}
          featured
          index={0}
          onPress={() =>
            visiblePhotos[0]
              ? onOpenPhoto(0, resolvedPhotos)
              : onEditPhotos()
          }
        />
        <View style={styles.photoSide}>
          <PhotoTile
            uri={resolvedPhotos[1]}
            label={visiblePhotos[1] ? undefined : "Add a photo"}
            styles={styles}
            index={1}
            onPress={() =>
              visiblePhotos[1]
                ? onOpenPhoto(1, resolvedPhotos)
                : onEditPhotos()
            }
          />
          <PhotoTile
            uri={resolvedPhotos[2]}
            label={
              photos.length > 3
                ? `+${photos.length - 3} more`
                : visiblePhotos[2]
                  ? undefined
                  : "Add a photo"
            }
            styles={styles}
            index={2}
            onPress={() =>
              visiblePhotos[2]
                ? onOpenPhoto(2, resolvedPhotos)
                : onEditPhotos()
            }
          />
        </View>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.photoLoadError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function PhotoTile({
  uri,
  label,
  styles,
  featured = false,
  index,
  onPress,
}: {
  uri?: string;
  label?: string;
  styles: ProfileStyles;
  featured?: boolean;
  index: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        uri ? `View profile photo ${index + 1}` : label ?? "Add a photo"
      }
      onPress={onPress}
      style={[styles.photoTile, featured && styles.featuredPhotoTile]}
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={styles.photo} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <View style={styles.addPhotoIcon}>
            <Text style={styles.addPhotoPlus}>+</Text>
          </View>
          <Text style={styles.addPhotoText}>{label}</Text>
        </View>
      )}
      {uri && label?.startsWith("+") ? (
        <View style={styles.photoCount}>
          <Text style={styles.photoCountText}>{label}</Text>
        </View>
      ) : null}
      {!uri && featured ? (
        <View style={styles.photoHint}>
          <Text style={styles.photoHintText}>Your first photo</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function SectionTitle({
  title,
  styles,
}: {
  title: string;
  styles: ProfileStyles;
}) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export function IdentityCard({
  title,
  subtitle,
  icon: Icon,
  colors,
  styles,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  colors: SystemColors;
  styles: ProfileStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.identityCard,
        pressed && styles.pressed,
      ]}
    >
      <Icon color="#E98B78" size={19} strokeWidth={1.8} />
      <Text style={styles.identityCardTitle}>{title}</Text>
      <Text style={styles.identityCardSubtitle}>{subtitle}</Text>
      <ChevronRight
        color={colors.textMuted}
        size={16}
        style={styles.identityCardArrow}
      />
    </Pressable>
  );
}

export function ProfileMenuItem({
  icon: Icon,
  title,
  subtitle,
  colors,
  styles,
  onPress,
  isLast = false,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  colors: SystemColors;
  styles: ProfileStyles;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        !isLast && styles.menuItemDivider,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.menuIcon}>
        <Icon color={colors.textSecondary} size={17} strokeWidth={1.8} />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={17} />
    </Pressable>
  );
}
