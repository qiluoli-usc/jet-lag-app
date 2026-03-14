import { StyleSheet, Text, View } from "react-native";

interface SummaryScreenProps {
  summary: Record<string, unknown> | null;
}

function asText(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "-";
}

export function SummaryScreen({ summary }: SummaryScreenProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Summary</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Winner</Text>
        <Text style={styles.value}>{asText(summary?.winner)}</Text>
        <Text style={styles.label}>Reason</Text>
        <Text style={styles.value}>{asText(summary?.reason)}</Text>
      </View>
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
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#666666",
    textTransform: "uppercase",
  },
  value: {
    fontSize: 14,
    fontWeight: "700",
    color: "#232323",
  },
});
