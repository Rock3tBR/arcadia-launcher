import { invoke } from "@tauri-apps/api/core";
import type {
  Achievement,
  DashboardStats,
  EmulatorConfig,
  GameRecord,
  Profile,
} from "../types";

export const api = {
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  createProfile: (name: string) => invoke<Profile>("create_profile", { name }),
  getActiveProfileId: () => invoke<number>("get_active_profile_id"),
  setActiveProfileId: (profileId: number) =>
    invoke<void>("set_active_profile_id", { profileId }),
  listGames: (profileId: number) =>
    invoke<GameRecord[]>("list_games", { profileId }),
  addGame: (input: {
    profileId: number;
    path: string;
    system: string;
    title: string;
  }) => invoke<GameRecord>("add_game", input),
  removeGame: (gameId: number) => invoke<void>("remove_game", { gameId }),
  listEmulatorConfigs: () => invoke<EmulatorConfig[]>("list_emulator_configs"),
  saveEmulatorConfig: (input: {
    system: string;
    executablePath: string;
    launchArguments: string;
  }) => invoke<EmulatorConfig>("save_emulator_config", input),
  launchGame: (gameId: number, profileId: number) =>
    invoke<void>("launch_game", { gameId, profileId }),
  listAchievements: (profileId: number) =>
    invoke<Achievement[]>("list_achievements", { profileId }),
  getDashboardStats: (profileId: number) =>
    invoke<DashboardStats>("get_dashboard_stats", { profileId }),
  startAppSession: () => invoke<number>("start_app_session"),
  heartbeatAppSession: (sessionId: number) =>
    invoke<void>("heartbeat_app_session", { sessionId }),
  endAppSession: (sessionId: number) =>
    invoke<void>("end_app_session", { sessionId }),
};
