import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { SystemColors } from "../systemColors";

const CATEGORIES = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "sentiment-satisfied-alt",
    emojis:
      "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👻 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾".split(
        " ",
      ),
  },
  {
    id: "people",
    label: "People",
    icon: "people",
    emojis:
      "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 🤲 🙏 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 🙍 🙎 💁 🙇 💃 🕺 🧍 🧎 🏃 🚶".split(
        " ",
      ),
  },
  {
    id: "animals",
    label: "Animals",
    icon: "pets",
    emojis:
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🦮 🐩 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🐿️ 🦔".split(
        " ",
      ),
  },
  {
    id: "food",
    label: "Food",
    icon: "restaurant",
    emojis:
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🧊".split(
        " ",
      ),
  },
  {
    id: "travel",
    label: "Travel",
    icon: "flight",
    emojis:
      "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚏 🛣️ 🛤️ 🚦 🚥 🚧 ⚓ 🛟 ⛵ 🚤 🛳️ ⛴️ 🚢 ✈️ 🛩️ 🛫 🛬 🪂 💺 🚁 🚟 🚠 🚡 🚀 🛸 🌍 🌎 🌏 🌐 🗺️ 🧭 🏔️ ⛰️ 🌋 🗻 🏕️ 🏖️ 🏜️ 🏝️ 🏞️ 🏟️ 🏛️ 🏗️ 🏘️ 🏚️ 🏠 🏡 🏢 🏣 🏤 🏥 🏦 🏨 🏩 🏪 🏫 🏬 🏭 🏯 🏰 💒 🗼 🗽 ⛪ 🕌 🛕 🕍 ⛩️ 🕋 ⛲ ⛺ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 🌌".split(
        " ",
      ),
  },
  {
    id: "activities",
    label: "Activities",
    icon: "sports-soccer",
    emojis:
      "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🏋️ 🤼 🤸 ⛹️ 🤺 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🪈 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩".split(
        " ",
      ),
  },
  {
    id: "objects",
    label: "Objects",
    icon: "lightbulb",
    emojis:
      "💌 💘 💝 💖 💗 💓 💞 💕 💟 ❣️ 💔 ❤️‍🔥 ❤️‍🩹 ❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 💋 💯 💢 💥 💫 💦 💨 🕳️ 💣 💬 👁️‍🗨️ 🗨️ 🗯️ 💭 💤 👋 ✍️ 💅 🤳 💍 💎 🔇 🔈 🔉 🔊 📢 📣 📯 🔔 🔕 🎼 🎵 🎶 🎙️ 🎚️ 🎛️ 🎤 🎧 📻 🎷 🪗 🎸 🎹 🎺 🎻 🪕 🥁 📱 📲 ☎️ 📞 📟 📠 🔋 🪫 🔌 💻 🖥️ 🖨️ ⌨️ 🖱️ 🖲️ 💽 💾 💿 📀 🧮 🎥 🎞️ 📽️ 🎬 📺 📷 📸 📹 📼 🔍 🔎 💡 🔦 🕯️ 🪔 📔 📕 📖 📗 📘 📙 📚 📓 📒 📃 📜 📰 🗞️ 📑 🔖 🏷️ 💰 🪙 💴 💵 💶 💷 💸 💳 🧾 💹 ✉️ 📧 📨 📩 📤 📥 📦 📫 📪 📬 📭 📮 🗳️ ✏️ ✒️ 🖋️ 🖊️ 🖌️ 🖍️ 📝 📁 📂 🗂️ 📅 📆 🗒️ 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 🖇️ 📏 📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏 🔐 🔑 🗝️ 🔨 🪓 ⛏️ ⚒️ 🛠️ 🗡️ ⚔️ 🔫 🪃 🛡️ 🔧 🪛 🔩 ⚙️ 🗜️ ⚖️ 🦯 🔗 ⛓️ 🪝 🧰 🧲 🪜 🧪 🧫 🧬 🔬 🔭 📡 💉 🩸 💊 🩹 🩺 🚪 🛗 🪞 🪟 🛏️ 🛋️ 🪑 🚽 🪠 🚿 🛁 🪤 🪒 🧴 🧷 🧹 🧺 🧻 🪣 🧼 🫧 🪥 🧽 🧯 🛒 🚬 ⚰️ 🪦 ⚱️ 🗿 🪧".split(
        " ",
      ),
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "tag-faces",
    emojis:
      "❤️ 🧡 💛 💚 💙 🩵 💜 🖤 🩶 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ✅ ❎ ➕ ➖ ➗ ✖️ ♾️ 💲 💱™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ⭐ 🌟 ✨ ⚡ 🔥 💧 🌈 🎵 🎶 ☀️ 🌙 ☁️".split(
        " ",
      ),
  },
];

type EmojiPickerProps = {
  visible: boolean;
  colors: SystemColors;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

const EmojiPicker = ({
  visible,
  colors,
  onSelect,
  onClose,
}: EmojiPickerProps) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [categoryId, setCategoryId] = useState("smileys");
  const [search, setSearch] = useState("");
  const category =
    CATEGORIES.find((item) => item.id === categoryId) || CATEGORIES[0];
  const emojis = useMemo(() => {
    const query = search.trim();
    if (!query) return category.emojis;
    return CATEGORIES.flatMap((item) => item.emojis).filter((emoji) =>
      emoji.includes(query),
    );
  }, [category.emojis, search]);

  if (!visible) return null;

  return (
    <View style={styles.picker}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose an emoji</Text>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close emoji picker"
          style={styles.closeButton}
        >
          <MaterialIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search emojis"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Search emojis"
      />
      {!search ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {CATEGORIES.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.categoryButton,
                categoryId === item.id && {
                  backgroundColor: colors.surfaceSecondary,
                },
              ]}
              onPress={() => setCategoryId(item.id)}
              accessibilityLabel={`${item.label} emoji`}
              accessibilityState={{ selected: categoryId === item.id }}
            >
              <MaterialIcons
                name={item.icon as keyof typeof MaterialIcons.glyphMap}
                size={20}
                color={
                  categoryId === item.id
                    ? colors.primary
                    : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.categoryText,
                  categoryId === item.id && { color: colors.primary },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      <Text style={styles.categoryTitle}>
        {search ? "Search results" : category.label}
      </Text>
      <ScrollView
        style={styles.emojiScroll}
        contentContainerStyle={styles.emojiGrid}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
      >
        {emojis.map((emoji, index) => (
          <TouchableOpacity
            key={`${emoji}-${index}`}
            style={styles.emojiButton}
            onPress={() => onSelect(emoji)}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        {!emojis.length ? (
          <Text style={styles.noResults}>No matching emojis</Text>
        ) : null}
      </ScrollView>
    </View>
  );
};

const createStyles = (colors: SystemColors) =>
  StyleSheet.create({
  picker: {
    maxHeight: 300,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
  },
  search: {
    marginHorizontal: 14,
    marginBottom: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 14,
  },
  categories: {
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  categoryButton: {
    minWidth: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 11,
  },
  categoryText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "600",
  },
  categoryTitle: {
    marginHorizontal: 17,
    marginTop: 9,
    marginBottom: 4,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  emojiScroll: {
    minHeight: 105,
    maxHeight: 150,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  emojiButton: {
    width: "12.5%",
    minHeight: 43,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  emoji: {
    fontSize: 25,
  },
  noResults: {
    padding: 18,
    color: colors.textSecondary,
    fontSize: 13,
  },
  });

export default EmojiPicker;
