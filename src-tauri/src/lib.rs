use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const SUPPORTED_SYSTEMS: &[&str] = &[
    "PS1",
    "PS2",
    "PS3",
    "PSP",
    "Nintendo DS",
    "GameCube",
    "Wii",
    "Nintendo Switch",
    "Outro",
];

struct AppState {
    database: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: i64,
    name: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameRecord {
    id: i64,
    title: String,
    system: String,
    path: String,
    added_at: i64,
    total_seconds: i64,
    last_played_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorConfig {
    system: String,
    executable_path: String,
    launch_arguments: String,
    configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Achievement {
    code: String,
    title: String,
    description: String,
    rarity: String,
    secret: bool,
    unlocked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardStats {
    library_count: i64,
    played_count: i64,
    total_game_seconds: i64,
    total_app_seconds: i64,
    achievement_count: i64,
}

#[derive(Debug, Clone)]
struct AchievementDefinition {
    code: &'static str,
    title: &'static str,
    description: &'static str,
    rarity: &'static str,
    secret: bool,
}

const ACHIEVEMENTS: &[AchievementDefinition] = &[
    AchievementDefinition {
        code: "first_launch",
        title: "Primeira partida",
        description: "Inicie seu primeiro jogo pelo Arcadia.",
        rarity: "comum",
        secret: false,
    },
    AchievementDefinition {
        code: "ten_sessions",
        title: "Pegou o ritmo",
        description: "Conclua 10 sessões de jogo.",
        rarity: "comum",
        secret: false,
    },
    AchievementDefinition {
        code: "explorer_5",
        title: "Explorador",
        description: "Jogue 5 títulos diferentes.",
        rarity: "rara",
        secret: false,
    },
    AchievementDefinition {
        code: "one_hour",
        title: "Só mais uma partida",
        description: "Acumule uma hora de jogo.",
        rarity: "rara",
        secret: false,
    },
    AchievementDefinition {
        code: "ten_hours",
        title: "Já virou rotina",
        description: "Acumule 10 horas de jogo.",
        rarity: "épica",
        secret: false,
    },
    AchievementDefinition {
        code: "marathon",
        title: "Maratona secreta",
        description: "Conclua uma sessão de jogo de pelo menos duas horas.",
        rarity: "secreta",
        secret: true,
    },
];

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64
}

fn validate_system(system: &str) -> Result<(), String> {
    if SUPPORTED_SYSTEMS.contains(&system) {
        Ok(())
    } else {
        Err("Sistema não suportado pelo Arcadia.".to_string())
    }
}

fn validate_name(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("Informe {label}."));
    }
    if normalized.chars().count() > max_chars {
        return Err(format!("{label} deve ter no máximo {max_chars} caracteres."));
    }
    if normalized.chars().any(char::is_control) {
        return Err(format!("{label} contém caracteres inválidos."));
    }
    Ok(normalized.to_string())
}

fn database_lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .database
        .lock()
        .map_err(|_| "O banco local ficou indisponível. Reinicie o Arcadia.".to_string())
}

fn initialize_database(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        r#"PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;

         CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            created_at INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            system TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            added_at INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS emulator_configs (
            system TEXT PRIMARY KEY,
            executable_path TEXT NOT NULL,
            launch_arguments TEXT NOT NULL,
            updated_at INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS game_progress (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            total_seconds INTEGER NOT NULL DEFAULT 0 CHECK(total_seconds >= 0),
            last_played_at INTEGER,
            PRIMARY KEY(profile_id, game_id)
         );

         CREATE TABLE IF NOT EXISTS game_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            exit_code INTEGER
         );

         CREATE TABLE IF NOT EXISTS app_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            last_heartbeat_at INTEGER NOT NULL,
            ended_at INTEGER
         );

         CREATE TABLE IF NOT EXISTS profile_achievements (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            unlocked_at INTEGER NOT NULL,
            PRIMARY KEY(profile_id, code)
         );

         CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
         CREATE INDEX IF NOT EXISTS idx_progress_profile ON game_progress(profile_id);
         CREATE INDEX IF NOT EXISTS idx_game_sessions_profile ON game_sessions(profile_id, started_at);
         CREATE INDEX IF NOT EXISTS idx_app_sessions_start ON app_sessions(started_at);"#,
    )?;

    let profile_count: i64 = connection.query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))?;
    if profile_count == 0 {
        connection.execute(
            "INSERT INTO profiles(name, created_at) VALUES(?1, ?2)",
            params!["Jogador", now_epoch()],
        )?;
    }

    let first_profile_id: i64 = connection.query_row(
        "SELECT id FROM profiles ORDER BY id LIMIT 1",
        [],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO app_settings(key, value) VALUES('active_profile_id', ?1)",
        params![first_profile_id.to_string()],
    )?;

    // Sessões deixadas abertas por um encerramento inesperado são recuperadas sem
    // inventar horas de jogo. O período não confirmado é descartado por segurança.
    connection.execute(
        "UPDATE game_sessions SET ended_at = started_at WHERE ended_at IS NULL",
        [],
    )?;
    connection.execute(
        "UPDATE app_sessions SET ended_at = last_heartbeat_at WHERE ended_at IS NULL",
        [],
    )?;

    Ok(())
}

fn profile_exists(connection: &Connection, profile_id: i64) -> Result<bool, rusqlite::Error> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM profiles WHERE id = ?1)",
        params![profile_id],
        |row| row.get(0),
    )
}

fn achievement_metrics(connection: &Connection, profile_id: i64) -> Result<(i64, i64, i64, i64), rusqlite::Error> {
    let launch_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM game_sessions WHERE profile_id = ?1 AND (ended_at IS NULL OR ended_at > started_at)",
        params![profile_id],
        |row| row.get(0),
    )?;
    let distinct_games: i64 = connection.query_row(
        "SELECT COUNT(DISTINCT game_id) FROM game_sessions WHERE profile_id = ?1 AND (ended_at IS NULL OR ended_at > started_at)",
        params![profile_id],
        |row| row.get(0),
    )?;
    let played_seconds: i64 = connection.query_row(
        "SELECT COALESCE(SUM(total_seconds), 0) FROM game_progress WHERE profile_id = ?1",
        params![profile_id],
        |row| row.get(0),
    )?;
    let longest_session: i64 = connection.query_row(
        "SELECT COALESCE(MAX(ended_at - started_at), 0) FROM game_sessions WHERE profile_id = ?1 AND ended_at IS NOT NULL",
        params![profile_id],
        |row| row.get(0),
    )?;
    Ok((launch_count, distinct_games, played_seconds, longest_session))
}

fn refresh_achievements(connection: &Connection, profile_id: i64) -> Result<Vec<Achievement>, rusqlite::Error> {
    let (launch_count, distinct_games, played_seconds, longest_session) =
        achievement_metrics(connection, profile_id)?;
    let mut newly_unlocked = Vec::new();

    for definition in ACHIEVEMENTS {
        let qualifies = match definition.code {
            "first_launch" => launch_count >= 1,
            "ten_sessions" => launch_count >= 10,
            "explorer_5" => distinct_games >= 5,
            "one_hour" => played_seconds >= 3_600,
            "ten_hours" => played_seconds >= 36_000,
            "marathon" => longest_session >= 7_200,
            _ => false,
        };
        if !qualifies {
            continue;
        }

        let unlocked_at = now_epoch();
        connection.execute(
            "INSERT OR IGNORE INTO profile_achievements(profile_id, code, unlocked_at) VALUES(?1, ?2, ?3)",
            params![profile_id, definition.code, unlocked_at],
        )?;
        if connection.changes() > 0 {
            newly_unlocked.push(Achievement {
                code: definition.code.to_string(),
                title: definition.title.to_string(),
                description: definition.description.to_string(),
                rarity: definition.rarity.to_string(),
                secret: definition.secret,
                unlocked_at: Some(unlocked_at),
            });
        }
    }
    Ok(newly_unlocked)
}

fn emit_unlocked(app: &AppHandle, achievements: Vec<Achievement>) {
    for achievement in achievements {
        let _ = app.emit("achievement-unlocked", achievement);
    }
}

fn canonical_file(path: &str, label: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(format!("O caminho de {label} precisa ser absoluto."));
    }
    let canonical = fs::canonicalize(candidate).map_err(|_| format!("Não foi possível localizar {label}."))?;
    let metadata = fs::metadata(&canonical).map_err(|_| format!("Não foi possível ler {label}."))?;
    if !metadata.is_file() {
        return Err(format!("O caminho de {label} não aponta para um arquivo."));
    }
    Ok(canonical)
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path).map_err(|_| "Não foi possível ler o executável.".to_string())?;
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("O arquivo selecionado não tem permissão de execução. Verifique as permissões do emulador.".to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn parse_launch_arguments(template: &str, game_path: &str) -> Result<Vec<String>, String> {
    if template.trim().is_empty() || template.len() > 2_048 {
        return Err("Informe os argumentos de inicialização e inclua {game}.".to_string());
    }
    if !template.contains("{game}") {
        return Err("Os argumentos precisam conter {game}, que será substituído pelo caminho do jogo.".to_string());
    }
    let parsed = shell_words::split(template)
        .map_err(|_| "Os argumentos do emulador têm aspas ou formatação inválida.".to_string())?;
    if parsed.is_empty() || parsed.len() > 64 {
        return Err("Use entre 1 e 64 argumentos de inicialização.".to_string());
    }
    let args: Vec<String> = parsed
        .iter()
        .map(|argument| argument.replace("{game}", game_path))
        .collect();
    if args.iter().any(|argument| argument.len() > 4_096) {
        return Err("Um dos argumentos excede o limite de tamanho.".to_string());
    }
    Ok(args)
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>, String> {
    let connection = database_lock(&state)?;
    let mut statement = connection
        .prepare("SELECT id, name, created_at FROM profiles ORDER BY name COLLATE NOCASE")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn create_profile(app: AppHandle, state: State<'_, AppState>, name: String) -> Result<Profile, String> {
    let normalized_name = validate_name(&name, "o nome do perfil", 32)?;
    let created_at = now_epoch();
    let profile = {
        let connection = database_lock(&state)?;
        connection
            .execute(
                "INSERT INTO profiles(name, created_at) VALUES(?1, ?2)",
                params![normalized_name, created_at],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE constraint failed") {
                    "Já existe um perfil com esse nome.".to_string()
                } else {
                    error.to_string()
                }
            })?;
        let id = connection.last_insert_rowid();
        Profile {
            id,
            name: normalized_name,
            created_at,
        }
    };
    let _ = app.emit("profiles-updated", ());
    Ok(profile)
}

#[tauri::command]
fn get_active_profile_id(state: State<'_, AppState>) -> Result<i64, String> {
    let connection = database_lock(&state)?;
    let saved_id: Option<String> = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'active_profile_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(value) = saved_id {
        if let Ok(profile_id) = value.parse::<i64>() {
            if profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
                return Ok(profile_id);
            }
        }
    }
    let profile_id: i64 = connection
        .query_row("SELECT id FROM profiles ORDER BY id LIMIT 1", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO app_settings(key, value) VALUES('active_profile_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![profile_id.to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(profile_id)
}

#[tauri::command]
fn set_active_profile_id(state: State<'_, AppState>, profile_id: i64) -> Result<(), String> {
    let connection = database_lock(&state)?;
    if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
        return Err("O perfil selecionado não existe.".to_string());
    }
    connection
        .execute(
            "INSERT INTO app_settings(key, value) VALUES('active_profile_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![profile_id.to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_games(state: State<'_, AppState>, profile_id: i64) -> Result<Vec<GameRecord>, String> {
    let connection = database_lock(&state)?;
    if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
        return Err("O perfil selecionado não existe.".to_string());
    }
    let mut statement = connection
        .prepare(
            r#"SELECT g.id, g.title, g.system, g.path, g.added_at,
                    COALESCE(p.total_seconds, 0) + COALESCE((
                      SELECT SUM(MAX(0, CAST(strftime('%s','now') AS INTEGER) - s.started_at))
                      FROM game_sessions s
                      WHERE s.game_id = g.id AND s.profile_id = ?1 AND s.ended_at IS NULL
                    ), 0) AS total_seconds,
                    p.last_played_at
             FROM games g
             LEFT JOIN game_progress p ON p.game_id = g.id AND p.profile_id = ?1
             ORDER BY COALESCE(p.last_played_at, 0) DESC, g.title COLLATE NOCASE ASC"#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![profile_id], |row| {
            Ok(GameRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                system: row.get(2)?,
                path: row.get(3)?,
                added_at: row.get(4)?,
                total_seconds: row.get(5)?,
                last_played_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn add_game(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    system: String,
    title: String,
) -> Result<GameRecord, String> {
    validate_system(&system)?;
    let normalized_title = validate_name(&title, "o título do jogo", 120)?;
    let canonical_path = canonical_file(&path, "jogo")?;
    let path_string = canonical_path.to_string_lossy().to_string();

    let game = {
        let connection = database_lock(&state)?;
        if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
            return Err("O perfil selecionado não existe.".to_string());
        }
        let added_at = now_epoch();
        connection
            .execute(
                "INSERT INTO games(title, system, path, added_at) VALUES(?1, ?2, ?3, ?4)",
                params![normalized_title, system, path_string, added_at],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE constraint failed: games.path") {
                    "Esse arquivo já está cadastrado na biblioteca.".to_string()
                } else {
                    error.to_string()
                }
            })?;
        GameRecord {
            id: connection.last_insert_rowid(),
            title: normalized_title,
            system,
            path: path_string,
            added_at,
            total_seconds: 0,
            last_played_at: None,
        }
    };
    let _ = app.emit("library-updated", ());
    Ok(game)
}

#[tauri::command]
fn remove_game(app: AppHandle, state: State<'_, AppState>, game_id: i64) -> Result<(), String> {
    let connection = database_lock(&state)?;
    connection
        .execute("DELETE FROM games WHERE id = ?1", params![game_id])
        .map_err(|error| error.to_string())?;
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
fn list_emulator_configs(state: State<'_, AppState>) -> Result<Vec<EmulatorConfig>, String> {
    let connection = database_lock(&state)?;
    let mut statement = connection
        .prepare("SELECT system, executable_path, launch_arguments FROM emulator_configs ORDER BY system")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(EmulatorConfig {
                system: row.get(0)?,
                executable_path: row.get(1)?,
                launch_arguments: row.get(2)?,
                configured: true,
            })
        })
        .map_err(|error| error.to_string())?;
    let configured = rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(SUPPORTED_SYSTEMS
        .iter()
        .map(|system| {
            configured
                .iter()
                .find(|config| config.system == *system)
                .cloned()
                .unwrap_or_else(|| EmulatorConfig {
                    system: (*system).to_string(),
                    executable_path: String::new(),
                    launch_arguments: "{game}".to_string(),
                    configured: false,
                })
        })
        .collect())
}

#[tauri::command]
fn save_emulator_config(
    state: State<'_, AppState>,
    system: String,
    executable_path: String,
    launch_arguments: String,
) -> Result<EmulatorConfig, String> {
    validate_system(&system)?;
    let canonical_executable = canonical_file(&executable_path, "executável do emulador")?;
    ensure_executable(&canonical_executable)?;
    // Faz validação sintática sem executar nada. O caminho de jogo real será injetado
    // somente ao iniciar uma partida e como argumento separado, nunca por shell.
    let _ = parse_launch_arguments(&launch_arguments, "/caminho/de/teste jogo.rom")?;
    let canonical_path = canonical_executable.to_string_lossy().to_string();
    let config = EmulatorConfig {
        system: system.clone(),
        executable_path: canonical_path.clone(),
        launch_arguments: launch_arguments.trim().to_string(),
        configured: true,
    };
    let connection = database_lock(&state)?;
    connection
        .execute(
            r#"INSERT INTO emulator_configs(system, executable_path, launch_arguments, updated_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(system) DO UPDATE SET executable_path = excluded.executable_path,
                launch_arguments = excluded.launch_arguments, updated_at = excluded.updated_at"#,
            params![system, canonical_path, launch_arguments.trim(), now_epoch()],
        )
        .map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    game_id: i64,
    profile_id: i64,
) -> Result<(), String> {
    let (game_path, executable_path, arguments, session_id, started_at) = {
        let connection = database_lock(&state)?;
        if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
            return Err("O perfil selecionado não existe.".to_string());
        }
        let game: (String, String) = connection
            .query_row(
                "SELECT path, system FROM games WHERE id = ?1",
                params![game_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O jogo não foi encontrado na biblioteca.".to_string())?;
        let game_path = canonical_file(&game.0, "arquivo do jogo")?;
        let config: (String, String) = connection
            .query_row(
                "SELECT executable_path, launch_arguments FROM emulator_configs WHERE system = ?1",
                params![game.1],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Configure um emulador para {} antes de iniciar este jogo.", game.1))?;
        let executable_path = canonical_file(&config.0, "executável do emulador")?;
        ensure_executable(&executable_path)?;
        let arguments = parse_launch_arguments(&config.1, &game_path.to_string_lossy())?;
        let started_at = now_epoch();
        connection
            .execute(
                "INSERT INTO game_sessions(profile_id, game_id, started_at) VALUES(?1, ?2, ?3)",
                params![profile_id, game_id, started_at],
            )
            .map_err(|error| error.to_string())?;
        let session_id = connection.last_insert_rowid();
        (game_path, executable_path, arguments, session_id, started_at)
    };

    let spawn_result = Command::new(&executable_path)
        .args(&arguments)
        .current_dir(game_path.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match spawn_result {
        Ok(child) => child,
        Err(error) => {
            if let Ok(connection) = state.database.lock() {
                let _ = connection.execute("DELETE FROM game_sessions WHERE id = ?1", params![session_id]);
            }
            return Err(format!("Não foi possível iniciar o emulador: {error}"));
        }
    };

    let unlocked_on_start = match state.database.lock() {
        Ok(connection) => refresh_achievements(&connection, profile_id).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    emit_unlocked(&app, unlocked_on_start);
    let _ = app.emit("library-updated", ());

    let database = Arc::clone(&state.database);
    let app_handle = app.clone();
    thread::spawn(move || {
        let exit_status = child.wait().ok();
        let ended_at = now_epoch();
        let elapsed_seconds = ended_at.saturating_sub(started_at).max(0);
        let exit_code = exit_status.and_then(|status| status.code());
        let mut newly_unlocked = Vec::new();

        if let Ok(connection) = database.lock() {
            let update_session = connection.execute(
                "UPDATE game_sessions SET ended_at = ?1, exit_code = ?2 WHERE id = ?3 AND ended_at IS NULL",
                params![ended_at, exit_code, session_id],
            );
            if update_session.is_ok() {
                let _ = connection.execute(
                    r#"INSERT INTO game_progress(profile_id, game_id, total_seconds, last_played_at)
                     VALUES(?1, ?2, ?3, ?4)
                     ON CONFLICT(profile_id, game_id) DO UPDATE SET
                       total_seconds = game_progress.total_seconds + excluded.total_seconds,
                       last_played_at = excluded.last_played_at"#,
                    params![profile_id, game_id, elapsed_seconds, ended_at],
                );
                if let Ok(achievements) = refresh_achievements(&connection, profile_id) {
                    newly_unlocked = achievements;
                }
            }
        }
        emit_unlocked(&app_handle, newly_unlocked);
        let _ = app_handle.emit("library-updated", ());
    });

    let _ = app.emit("game-launched", game_id);
    Ok(())
}

#[tauri::command]
fn list_achievements(state: State<'_, AppState>, profile_id: i64) -> Result<Vec<Achievement>, String> {
    let connection = database_lock(&state)?;
    if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
        return Err("O perfil selecionado não existe.".to_string());
    }
    ACHIEVEMENTS
        .iter()
        .map(|definition| {
            let unlocked_at: Option<i64> = connection
                .query_row(
                    "SELECT unlocked_at FROM profile_achievements WHERE profile_id = ?1 AND code = ?2",
                    params![profile_id, definition.code],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            Ok(Achievement {
                code: definition.code.to_string(),
                title: if definition.secret && unlocked_at.is_none() {
                    "Conquista secreta".to_string()
                } else {
                    definition.title.to_string()
                },
                description: if definition.secret && unlocked_at.is_none() {
                    "Continue jogando para descobrir esta conquista.".to_string()
                } else {
                    definition.description.to_string()
                },
                rarity: definition.rarity.to_string(),
                secret: definition.secret,
                unlocked_at,
            })
        })
        .collect()
}

#[tauri::command]
fn get_dashboard_stats(state: State<'_, AppState>, profile_id: i64) -> Result<DashboardStats, String> {
    let connection = database_lock(&state)?;
    if !profile_exists(&connection, profile_id).map_err(|error| error.to_string())? {
        return Err("O perfil selecionado não existe.".to_string());
    }
    let library_count: i64 = connection.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    let played_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM game_progress WHERE profile_id = ?1 AND (total_seconds > 0 OR last_played_at IS NOT NULL)",
        params![profile_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let total_game_seconds: i64 = connection.query_row(
        r#"SELECT
          COALESCE((SELECT SUM(total_seconds) FROM game_progress WHERE profile_id = ?1), 0)
          + COALESCE((SELECT SUM(MAX(0, CAST(strftime('%s','now') AS INTEGER) - started_at))
            FROM game_sessions WHERE profile_id = ?1 AND ended_at IS NULL), 0)"#,
        params![profile_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let total_app_seconds: i64 = connection.query_row(
        "SELECT COALESCE(SUM(MAX(0, COALESCE(ended_at, last_heartbeat_at) - started_at)), 0) FROM app_sessions",
        [],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let achievement_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM profile_achievements WHERE profile_id = ?1",
        params![profile_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    Ok(DashboardStats {
        library_count,
        played_count,
        total_game_seconds,
        total_app_seconds,
        achievement_count,
    })
}

#[tauri::command]
fn start_app_session(state: State<'_, AppState>) -> Result<i64, String> {
    let connection = database_lock(&state)?;
    let started_at = now_epoch();
    connection
        .execute(
            "INSERT INTO app_sessions(started_at, last_heartbeat_at) VALUES(?1, ?1)",
            params![started_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection.last_insert_rowid())
}

#[tauri::command]
fn heartbeat_app_session(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let connection = database_lock(&state)?;
    connection
        .execute(
            "UPDATE app_sessions SET last_heartbeat_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![now_epoch(), session_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn end_app_session(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let connection = database_lock(&state)?;
    let current_time = now_epoch();
    connection
        .execute(
            "UPDATE app_sessions SET last_heartbeat_at = ?1, ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![current_time, session_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let application_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&application_data_dir)?;
            let database_path = application_data_dir.join("arcadia.sqlite3");
            let connection = Connection::open(database_path)?;
            connection.busy_timeout(Duration::from_secs(5))?;
            initialize_database(&connection)?;
            app.manage(AppState {
                database: Arc::new(Mutex::new(connection)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            create_profile,
            get_active_profile_id,
            set_active_profile_id,
            list_games,
            add_game,
            remove_game,
            list_emulator_configs,
            save_emulator_config,
            launch_game,
            list_achievements,
            get_dashboard_stats,
            start_app_session,
            heartbeat_app_session,
            end_app_session
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Arcadia Launcher");
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_arguments_keep_game_path_as_one_argument() {
        let args = parse_launch_arguments(
            "--fullscreen \"{game}\"",
            "/games/my game.iso",
        )
        .expect("argument template should be valid");

        assert_eq!(args, vec!["--fullscreen".to_string(), "/games/my game.iso".to_string()]);
    }

    #[test]
    fn launch_arguments_do_not_interpret_shell_metacharacters() {
        let args = parse_launch_arguments(
            "--label \"{game}; echo not-a-shell-command\"",
            "/games/my game.iso",
        )
        .expect("semicolon is an ordinary character when no shell is invoked");

        assert_eq!(args.len(), 2);
        assert_eq!(args[1], "/games/my game.iso; echo not-a-shell-command");
    }

    #[test]
    fn launch_arguments_require_game_placeholder() {
        let result = parse_launch_arguments("--fullscreen", "/games/game.iso");
        assert!(result.is_err());
    }

    #[test]
    fn names_reject_empty_or_control_characters() {
        assert!(validate_name("   ", "o nome", 32).is_err());
        assert!(validate_name("perfil\nmalicioso", "o nome", 32).is_err());
        assert_eq!(validate_name("  Jogador  ", "o nome", 32).unwrap(), "Jogador");
    }

    #[test]
    fn database_initializes_with_a_default_profile() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
        initialize_database(&connection).expect("schema should initialize");

        let profile_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))
            .expect("profiles table should exist");
        assert_eq!(profile_count, 1);

        let profile_name: String = connection
            .query_row("SELECT name FROM profiles LIMIT 1", [], |row| row.get(0))
            .expect("default profile should exist");
        assert_eq!(profile_name, "Jogador");
    }
}
