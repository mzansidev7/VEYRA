import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import type { SystemColors } from "../systemColors";

export function IdentityVerifiedBadge({
  colors,
  compact = false,
}: {
  colors: SystemColors;
  compact?: boolean;
}) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Identity Verified. Government identity successfully checked."
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 4 : 7,
        paddingHorizontal: compact ? 7 : 11,
        paddingVertical: compact ? 4 : 8,
        borderWidth: 1,
        borderColor: `${colors.success}66`,
        borderRadius: 999,
        backgroundColor: colors.surface,
      }}
    >
      <ShieldCheck color={colors.success} size={compact ? 13 : 17} />
      <View>
        <Text
          style={{
            color: colors.success,
            fontSize: compact ? 9 : 12,
            lineHeight: compact ? 12 : 16,
            fontWeight: "700",
          }}
        >
          Identity Verified
        </Text>
        {!compact ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 10,
              lineHeight: 14,
            }}
          >
            Government identity successfully checked
          </Text>
        ) : null}
      </View>
    </View>
  );
}
