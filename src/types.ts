export type Page = "library" | "achievements" | "emulators" | "stats";

export interface Profile {
  id: number;
  name: string;
  createdAt: number;
}

export interface GameRecord {
  id: number;
  title: string;
  system: string;
  path: string;
  addedAt: number;
  totalSeconds: number;
  lastPlayedAt: number | null;
}

export interface EmulatorConfig {
  system: string;
  executablePath: string;
  launchArguments: string;
  configured: boolean;
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  rarity: string;
  secret: boolean;
  unlockedAt: number | null;
}

export interface DashboardStats {
  libraryCount: number;
  playedCount: number;
  totalGameSeconds: number;
  totalAppSeconds: number;
  achievementCount: number;
}

export interface EmulatorDraft {
  executablePath: string;
  launchArguments: string;
}

export const SUPPORTED_SYSTEMS = [
  "PS1",
  "PS2",
  "PS3",
  "PSP",
  "Nintendo DS",
  "GameCube",
  "Wii",
  "Nintendo Switch",
  "Outro",
] as const;
