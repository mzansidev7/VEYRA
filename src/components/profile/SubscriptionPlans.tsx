import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronLeft, Crown, Sparkles, X } from "lucide-react-native";
import type { SystemColors } from "../../systemColors";
import { ProfileMenuItem } from "./ProfileControls";
import type { ProfileStyles } from "./ProfileScreen";

type Plan = {
  name: string;
  price: string;
  tagline: string;
  badge?: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    name: "FREE",
    price: "R0",
    tagline: "Start meaningful connections",
    features: [
      "Create and customise your profile with photos and a voice intro",
      "Complete Dating DNA and set dating preferences",
      "Daily 5 recommendations and limited Explore likes",
      "Receive likes, view matches and message your matches",
      "Identity verification and a verified profile badge",
      "Basic Chemistry insights and Video Discovery with fair-use limits",
      "Online status, chat attachments and read receipts",
      "Profile visitors, with a proposed 30-day history",
      "Block and report users; manage privacy and visibility",
    ],
  },
  {
    name: "PLUS",
    price: "R99",
    tagline: "Discover more possibilities",
    features: [
      "Everything in Free",
      "See who likes you",
      "5 additional daily likes",
      "Rewind your last pass",
      "Advanced discovery filters and more profile discovery",
      "Full compatibility breakdown",
      "Proposed 90-day visitor history",
    ],
  },
  {
    name: "PREMIUM",
    price: "R179",
    tagline: "Everything in Plus, with more ways to connect",
    badge: "POPULAR",
    features: [
      "Everything in Plus",
      "Fair-use unlimited Explore likes",
      "10 Daily 5 replacements or refreshes",
      "Priority profile exposure",
      "Advanced Chemistry insights",
      "Proposed 180-day visitor history",
      "Incognito browsing and more visibility controls",
      "Additional Video Discovery opportunities",
    ],
  },
  {
    name: "ELITE",
    price: "R299",
    tagline: "The complete VEYRA experience",
    features: [
      "Everything in Premium",
      "Priority Likes",
      "3 profile boosts per month",
      "Advanced profile performance insights",
      "Proposed 365-day visitor history",
      "Premium discovery filters and more Daily 5 refreshes",
      "Enhanced visibility controls and exclusive profile badges",
    ],
  },
];

export function SubscriptionPlans({
  colors,
  styles: profileStyles,
}: {
  colors: SystemColors;
  styles: ProfileStyles;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [visible, setVisible] = useState(false);

  return (
    <>
      <View style={styles.buttonContainer}>
        <ProfileMenuItem
          icon={Sparkles}
          title="VEYRA plans"
          subtitle="Explore Free, Plus, Premium and Elite"
          colors={colors}
          styles={profileStyles}
          onPress={() => setVisible(true)}
          isLast
        />
      </View>
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close plans"
              onPress={() => setVisible(false)}
              style={styles.closeButton}
            >
              <ChevronLeft color={colors.text} size={21} />
            </Pressable>
            <Text style={styles.modalTitle}>VEYRA plans</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close plans"
              onPress={() => setVisible(false)}
              style={styles.closeButton}
            >
              <X color={colors.textSecondary} size={18} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heading}>
              <View style={styles.headingIcon}>
                <Sparkles color={colors.like} size={17} />
              </View>
              <View style={styles.headingCopy}>
                <Text style={styles.title}>Choose how you want to discover</Text>
                <Text style={styles.subtitle}>
                  Find the plan that fits your journey
                </Text>
              </View>
            </View>
            <Text style={styles.notice}>
              Plan preview only. All current features remain available to
              everyone; billing and plan-based limits are not active.
            </Text>
            {PLANS.map((plan) => (
              <View
                key={plan.name}
                style={[
                  styles.planCard,
                  plan.badge ? styles.popularCard : null,
                ]}
              >
                {plan.badge ? (
                  <View
                    style={[
                      styles.popularBadge,
                      { backgroundColor: colors.brandMagenta },
                    ]}
                  >
                    <Crown color="#1D1720" size={11} />
                    <Text style={styles.popularBadgeText}>{plan.badge}</Text>
                  </View>
                ) : null}
                <Text style={styles.planName}>{plan.name}</Text>
                <View style={styles.priceLine}>
                  <Text style={styles.price}>{plan.price}</Text>
                  <Text style={styles.pricePeriod}>/ month</Text>
                </View>
                <Text style={styles.tagline}>{plan.tagline}</Text>
                <View style={styles.divider} />
                {plan.features.map((feature) => (
                  <View key={feature} style={styles.feature}>
                    <Check
                      color={colors.success}
                      size={14}
                      strokeWidth={2.5}
                    />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors: SystemColors) =>
  StyleSheet.create({
    buttonContainer: {
      paddingHorizontal: 9,
      borderRadius: 14,
      marginTop: 18,
      backgroundColor: colors.card,
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headingIcon: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 11,
      backgroundColor: colors.surfaceSecondary,
    },
    headingCopy: {
      flex: 1,
    },
    title: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 10,
      marginTop: 2,
    },
    notice: {
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 9,
      marginBottom: 10,
    },
    modal: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      backgroundColor: colors.surfaceSecondary,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    modalContent: {
      padding: 18,
      paddingBottom: 36,
    },
    planCard: {
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      backgroundColor: colors.card,
    },
    popularCard: {
      borderColor: colors.brandViolet,
    },
    popularBadge: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 10,
      marginBottom: 8,
      backgroundColor: colors.brandMagenta,
    },
    popularBadgeText: {
      color: "#1D1720",
      fontSize: 8,
      fontWeight: "800",
      letterSpacing: 0.6,
    },
    planName: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.8,
    },
    priceLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 4,
      marginTop: 5,
    },
    price: {
      color: colors.text,
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    pricePeriod: {
      color: colors.textSecondary,
      fontSize: 10,
    },
    tagline: {
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 3,
      minHeight: 30,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginVertical: 9,
      backgroundColor: colors.divider,
    },
    feature: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 7,
      marginBottom: 8,
    },
    featureText: {
      flex: 1,
      color: colors.text,
      fontSize: 10,
      lineHeight: 15,
    },
  });
