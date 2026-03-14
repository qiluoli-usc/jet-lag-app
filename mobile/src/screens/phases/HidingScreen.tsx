import { StyleSheet, Text, View } from "react-native";

export function HidingScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Hiding</Text>
      <Text style={styles.desc}>Hider is moving. Seekers are waiting for seek phase.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  desc: {
    fontSize: 13,
    color: "#5e5e5e",
  },
});
