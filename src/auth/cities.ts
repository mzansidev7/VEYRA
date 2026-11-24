export type CityOption = {
  city: string;
  province: string;
  country: string;
  latitude: number;
  longitude: number;
  source: "manual" | "gps";
};

export const SOUTH_AFRICAN_CITIES: CityOption[] = [
  { city: "Johannesburg", province: "Gauteng", country: "South Africa", latitude: -26.2041, longitude: 28.0473, source: "manual" },
  { city: "Pretoria", province: "Gauteng", country: "South Africa", latitude: -25.7479, longitude: 28.2293, source: "manual" },
  { city: "Bloemfontein", province: "Free State", country: "South Africa", latitude: -29.0852, longitude: 26.1596, source: "manual" },
  { city: "Durban", province: "KwaZulu-Natal", country: "South Africa", latitude: -29.8587, longitude: 31.0218, source: "manual" },
  { city: "Cape Town", province: "Western Cape", country: "South Africa", latitude: -33.9249, longitude: 18.4241, source: "manual" },
  { city: "Gqeberha", province: "Eastern Cape", country: "South Africa", latitude: -33.9608, longitude: 25.6022, source: "manual" },
  { city: "East London", province: "Eastern Cape", country: "South Africa", latitude: -33.0153, longitude: 27.9116, source: "manual" },
  { city: "Kimberley", province: "Northern Cape", country: "South Africa", latitude: -28.7282, longitude: 24.7499, source: "manual" },
  { city: "Polokwane", province: "Limpopo", country: "South Africa", latitude: -23.9045, longitude: 29.4689, source: "manual" },
  { city: "Nelspruit", province: "Mpumalanga", country: "South Africa", latitude: -25.4753, longitude: 30.9694, source: "manual" },
  { city: "Rustenburg", province: "North West", country: "South Africa", latitude: -25.6676, longitude: 27.2421, source: "manual" },
  { city: "George", province: "Western Cape", country: "South Africa", latitude: -33.963, longitude: 22.4617, source: "manual" },
  { city: "Stellenbosch", province: "Western Cape", country: "South Africa", latitude: -33.9321, longitude: 18.8602, source: "manual" },
  { city: "Pietermaritzburg", province: "KwaZulu-Natal", country: "South Africa", latitude: -29.6006, longitude: 30.3794, source: "manual" },
  { city: "Soweto", province: "Gauteng", country: "South Africa", latitude: -26.2485, longitude: 27.854, source: "manual" },
  { city: "Midrand", province: "Gauteng", country: "South Africa", latitude: -25.9992, longitude: 28.1263, source: "manual" },
  { city: "Sandton", province: "Gauteng", country: "South Africa", latitude: -26.1076, longitude: 28.0567, source: "manual" },
  { city: "Centurion", province: "Gauteng", country: "South Africa", latitude: -25.8603, longitude: 28.1894, source: "manual" },
  { city: "Benoni", province: "Gauteng", country: "South Africa", latitude: -26.1885, longitude: 28.3208, source: "manual" },
  { city: "Welkom", province: "Free State", country: "South Africa", latitude: -27.9774, longitude: 26.7351, source: "manual" },
  { city: "Mthatha", province: "Eastern Cape", country: "South Africa", latitude: -31.5889, longitude: 28.7844, source: "manual" },
  { city: "Mahikeng", province: "North West", country: "South Africa", latitude: -25.8652, longitude: 25.6442, source: "manual" },
];
