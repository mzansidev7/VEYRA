import { createElement, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import type { SystemColors } from "../systemColors";

type Props = {
  value: string;
  onChange: (value: string) => void;
  colors: SystemColors;
};

const MINIMUM_DATE = new Date(1900, 0, 1);

export function BirthdayField({ value, onChange, colors }: Props) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => getPickerDate(value));
  const maximumDate = getMaximumDate();

  if (Platform.OS === "web") {
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Birthday</Text>
        {createElement("input", {
          "aria-label": "Birthday",
          type: "date",
          value,
          min: "1900-01-01",
          max: formatDate(maximumDate),
          onChange: (event: Event) =>
            onChange((event.currentTarget as HTMLInputElement).value),
          style: {
            boxSizing: "border-box",
            width: "100%",
            height: 50,
            padding: "0 14px",
            border: `1px solid ${colors.border}`,
            borderRadius: 13,
            color: colors.text,
            backgroundColor: colors.inputBackground,
            fontSize: 13,
            fontFamily: "inherit",
          },
        })}
      </View>
    );
  }

  const openPicker = () => {
    setDraftDate(getPickerDate(value));
    setOpen(true);
  };

  const handleChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === "android") {
      setOpen(false);
      if (event.type === "set" && selectedDate) {
        onChange(formatDate(selectedDate));
      }
      return;
    }
    if (selectedDate) setDraftDate(selectedDate);
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>Birthday</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Birthday: ${value || "Choose your date"}`}
        onPress={openPicker}
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={{ color: value ? colors.text : colors.textMuted }}>
          {value || "Choose your date"}
        </Text>
      </Pressable>

      {Platform.OS === "ios" ? (
        <Modal
          animationType="slide"
          transparent
          visible={open}
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalContent,
                { backgroundColor: colors.surface },
              ]}
            >
              <View style={styles.modalActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpen(false)}
                >
                  <Text style={[styles.actionText, { color: colors.textMuted }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(formatDate(draftDate));
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    Done
                  </Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={draftDate}
                mode="date"
                display="spinner"
                minimumDate={MINIMUM_DATE}
                maximumDate={maximumDate}
                onChange={handleChange}
              />
            </View>
          </View>
        </Modal>
      ) : open ? (
        <DateTimePicker
          value={draftDate}
          mode="date"
          display="default"
          minimumDate={MINIMUM_DATE}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}

function getPickerDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    if (
      date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
    ) {
      return date;
    }
  }
  return getMaximumDate();
}

function getMaximumDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  field: { marginTop: 18 },
  label: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  input: {
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 13,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalContent: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  actionText: { fontSize: 16, fontWeight: "600" },
});
