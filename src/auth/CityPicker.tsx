import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import type { SystemColors } from "../systemColors";
import {
  SOUTH_AFRICAN_CITIES,
  type CityOption,
} from "./cities";

type Props = {
  city: string;
  province: string;
  onSelect: (location: CityOption) => void;
  colors: SystemColors;
};

export function CityPicker({ city, province, onSelect, colors }: Props) {
  const [query, setQuery] = useState(city);
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return SOUTH_AFRICAN_CITIES.slice(0, 7);
    return SOUTH_AFRICAN_CITIES.filter(
      (option) =>
        option.city.toLocaleLowerCase().includes(normalizedQuery) ||
        option.province.toLocaleLowerCase().includes(normalizedQuery),
    ).slice(0, 7);
  }, [query]);

  const useCurrentLocation = async () => {
    setLocationError("");
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Location permission was not granted.");
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const location =
        Platform.OS === "web"
          ? getNearestListedCity(
              position.coords.latitude,
              position.coords.longitude,
            )
          : await getReverseGeocodedCity(
              position.coords.latitude,
              position.coords.longitude,
            );
      setQuery(location.city);
      onSelect(location);
    } catch (error) {
      setLocationError(
        error instanceof Error
          ? error.message
          : "Could not get your current location.",
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>Where are you based?</Text>
      <Text style={[styles.helper, { color: colors.textSecondary }]}>
        Choose your city so we can introduce you to people nearby.
      </Text>
      <TextInput
        accessibilityLabel="Search city"
        autoCapitalize="words"
        onChangeText={setQuery}
        placeholder="Search South African cities"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.inputBackground,
            borderColor: colors.border,
          },
        ]}
        value={query}
      />
      {results.length ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={[
            styles.results,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {results.map((option) => (
            <Pressable
              key={option.city}
              accessibilityRole="button"
              onPress={() => {
                setQuery(option.city);
                setLocationError("");
                onSelect(option);
              }}
              style={[
                styles.result,
                { borderBottomColor: colors.border },
                city === option.city && styles.selectedResult,
              ]}
            >
              <Text style={[styles.city, { color: colors.text }]}>
                {option.city}
              </Text>
              <Text style={[styles.province, { color: colors.textSecondary }]}>
                {option.province}, {option.country}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          No matching city. Try a nearby major city.
        </Text>
      )}
      {city ? (
        <Text style={[styles.selectedLocation, { color: colors.textSecondary }]}>
          Selected: {city}{province ? ` · ${province}` : ""}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={locating}
        onPress={() => void useCurrentLocation()}
        style={[styles.gpsButton, { borderColor: colors.border }]}
      >
        {locating ? <ActivityIndicator color={colors.primary} /> : null}
        <Text style={[styles.gpsText, { color: colors.primary }]}>
          {locating ? "Finding your location…" : "Use my current location"}
        </Text>
      </Pressable>
      {locationError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {locationError}
        </Text>
      ) : null}
      <Text style={[styles.privacy, { color: colors.textMuted }]}>
        Your exact location is private and is never shown on your profile.
      </Text>
    </View>
  );
}

async function getReverseGeocodedCity(
  latitude: number,
  longitude: number,
): Promise<CityOption> {
  const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
  const city =
    address?.city ?? address?.district ?? address?.subregion ?? address?.region;
  if (!city) throw new Error("We couldn’t identify a city at your location.");
  return {
    city,
    province: address?.region ?? "",
    country: address?.country ?? "South Africa",
    latitude,
    longitude,
    source: "gps",
  };
}

function getNearestListedCity(latitude: number, longitude: number): CityOption {
  const nearest = SOUTH_AFRICAN_CITIES
    .map((city) => ({
      city,
      distance: calculateDistanceKm(
        latitude,
        longitude,
        city.latitude,
        city.longitude,
      ),
    }))
    .sort((first, second) => first.distance - second.distance)[0];
  if (!nearest || nearest.distance > 100) {
    throw new Error(
      "We couldn’t match your location to a listed city. Please choose your city manually.",
    );
  }
  return {
    ...nearest.city,
    latitude,
    longitude,
    source: "gps",
  };
}

function calculateDistanceKm(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(secondLatitude - firstLatitude);
  const longitudeDelta = radians(secondLongitude - firstLongitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(firstLatitude)) *
      Math.cos(radians(secondLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(haversine));
}

const styles = StyleSheet.create({
  container: { marginTop: 18 },
  label: { fontSize: 14, fontWeight: "700" },
  helper: { fontSize: 11, lineHeight: 16, marginTop: 5, marginBottom: 10 },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 13,
    fontSize: 13,
  },
  results: {
    maxHeight: 190,
    borderWidth: 1,
    borderRadius: 13,
    marginTop: 6,
  },
  result: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectedResult: { backgroundColor: "rgba(201,188,229,0.12)" },
  city: { fontSize: 13, fontWeight: "600" },
  province: { fontSize: 10, marginTop: 3 },
  empty: { fontSize: 11, paddingVertical: 12 },
  selectedLocation: { fontSize: 10, marginTop: 8 },
  gpsButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  gpsText: { fontSize: 12, fontWeight: "700" },
  privacy: { fontSize: 10, lineHeight: 15, marginTop: 8 },
  error: { color: "#E58A91", fontSize: 11, marginTop: 8 },
});
