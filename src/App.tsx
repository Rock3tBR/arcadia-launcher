import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Gamepad2,
  Gem,
  HardDrive,
  LibraryBig,
  LockKeyhole,
  MonitorCog,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { api } from "./lib/api";
import type {
  Achievement,
  DashboardStats,
  EmulatorConfig,
  EmulatorDraft,
  GameRecord,
  Page,
  Profile,
} from "./types";
import { SUPPORTED_SYSTEMS } from "./types";

const EMPTY_STATS: DashboardStats = {
  libraryCount: 0,
  playedCount: 0,
  totalGameSeconds: 0,
  totalAppSeconds: 0,
  achievementCount: 0,
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds}s`;
}

function formatDate(epochSeconds: number | null): string {
  if (!epochSeconds) return "Ainda não jogado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(epochSeconds * 1_000));
}

function filenameFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;
  return filename.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim();
}

function App() {
  const [page, setPage] = useState<Page>("library");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [emulatorConfigs, setEmulatorConfigs] = useState<EmulatorConfig[]>([]);
  const [emulatorDrafts, setEmulatorDrafts] = useState<Record<string, EmulatorDraft>>({});
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [systemFilter, setSystemFilter] = useState("Todos os sistemas");
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [gamePathDraft, setGamePathDraft] = useState("");
  const [gameTitleDraft, setGameTitleDraft] = useState("");
  const [gameSystemDraft, setGameSystemDraft] = useState<string>("PS2");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [showAddGame, setShowAddGame] = useState(false);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [achievementToast, setAchievementToast] = useState<Achievement | null>(null);
  const activeProfileIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeProfileIdRef.current = activeProfileId;
  }, [activeProfileId]);

  const loadData = useCallback(async (preferredProfileId?: number) => {
    const loadedProfiles = await api.listProfiles();
    setProfiles(loadedProfiles);
    const persistedProfileId = await api.getActiveProfileId();
    const selectedId = preferredProfileId ?? persistedProfileId;
    const profileId = loadedProfiles.some((profile) => profile.id === selectedId)
      ? selectedId
      : loadedProfiles[0]?.id;

    if (profileId == null) {
      throw new Error("Não foi possível carregar um perfil local.");
    }

    setActiveProfileId(profileId);
    const [loadedGames, loadedAchievements, loadedConfigs, loadedStats] =
      await Promise.all([
        api.listGames(profileId),
        api.listAchievements(profileId),
        api.listEmulatorConfigs(),
        api.getDashboardStats(profileId),
      ]);
    setGames(loadedGames);
    setAchievements(loadedAchievements);
    setEmulatorConfigs(loadedConfigs);
    setStats(loadedStats);
    setEmulatorDrafts((current) => {
      const next = { ...current };
      for (const config of loadedConfigs) {
        next[config.system] ??= {
          executablePath: config.executablePath,
          launchArguments: config.launchArguments || "{game}",
        };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let appSessionId: number | null = null;
    let heartbeatInterval: number | undefined;
    let stopAchievementListener: UnlistenFn | undefined;
    let stopLibraryListener: UnlistenFn | undefined;

    const initialize = async () => {
      try {
        await loadData();
        if (disposed) return;

        appSessionId = await api.startAppSession();
        if (disposed) {
          await api.endAppSession(appSessionId).catch(() => undefined);
          return;
        }
        stopAchievementListener = await listen<Achievement>(
          "achievement-unlocked",
          (event) => {
            setAchievementToast(event.payload);
            setSuccessMessage("");
            void loadData(activeProfileIdRef.current ?? undefined).catch(() => undefined);
          },
        );
        if (disposed) {
          stopAchievementListener();
          await api.endAppSession(appSessionId).catch(() => undefined);
          return;
        }
        stopLibraryListener = await listen("library-updated", () => {
          void loadData(activeProfileIdRef.current ?? undefined).catch(() => undefined);
        });
        if (disposed) {
          stopAchievementListener();
          stopLibraryListener();
          await api.endAppSession(appSessionId).catch(() => undefined);
          return;
        }
        heartbeatInterval = window.setInterval(() => {
          if (appSessionId == null) return;
          void api.heartbeatAppSession(appSessionId)
            .then(async () => {
              const profileId = activeProfileIdRef.current;
              if (profileId == null) return;
              const updatedStats = await api.getDashboardStats(profileId);
              setStats(updatedStats);
            })
            .catch(() => undefined);
        }, 15_000);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void initialize();
    return () => {
      disposed = true;
      if (heartbeatInterval != null) window.clearInterval(heartbeatInterval);
      stopAchievementListener?.();
      stopLibraryListener?.();
      if (appSessionId != null) void api.endAppSession(appSessionId).catch(() => undefined);
    };
  }, [loadData]);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(""), 3_500);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!achievementToast) return;
    const timeout = window.setTimeout(() => setAchievementToast(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [achievementToast]);

  const filteredGames = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("pt-BR");
    return games.filter((game) => {
      const matchesSystem = systemFilter === "Todos os sistemas" || game.system === systemFilter;
      const matchesQuery =
        query.length === 0 ||
        game.title.toLocaleLowerCase("pt-BR").includes(query) ||
        game.system.toLocaleLowerCase("pt-BR").includes(query);
      return matchesSystem && matchesQuery;
    });
  }, [games, searchQuery, systemFilter]);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlockedAt != null).length;

  const handleAddGameClick = async () => {
    setErrorMessage("");
    try {
      const chosenPath = await open({
        multiple: false,
        directory: false,
        title: "Selecione um arquivo de jogo que você já possui",
      });
      if (typeof chosenPath !== "string") return;
      setGamePathDraft(chosenPath);
      setGameTitleDraft(filenameFromPath(chosenPath));
      setGameSystemDraft("PS2");
      setShowAddGame(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveGame = async () => {
    if (activeProfileId == null || !gamePathDraft) return;
    setErrorMessage("");
    try {
      await api.addGame({
        profileId: activeProfileId,
        path: gamePathDraft,
        system: gameSystemDraft,
        title: gameTitleDraft,
      });
      setShowAddGame(false);
      setSuccessMessage("Jogo adicionado à biblioteca.");
      await loadData(activeProfileId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCreateProfile = async () => {
    setErrorMessage("");
    try {
      const profile = await api.createProfile(profileNameDraft);
      await api.setActiveProfileId(profile.id);
      setProfileNameDraft("");
      setShowAddProfile(false);
      setSuccessMessage(`Perfil “${profile.name}” criado.`);
      await loadData(profile.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleChangeProfile = async (profileId: number) => {
    setErrorMessage("");
    try {
      await api.setActiveProfileId(profileId);
      await loadData(profileId);
      setSelectedGame(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLaunchGame = async (game: GameRecord) => {
    if (activeProfileId == null) return;
    setErrorMessage("");
    try {
      await api.launchGame(game.id, activeProfileId);
      setSuccessMessage(`Iniciando ${game.title}…`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setSelectedGame(null);
      setPage("emulators");
    }
  };

  const handleRemoveGame = async (game: GameRecord) => {
    const confirmed = window.confirm(
      `Remover “${game.title}” da biblioteca? O histórico e o tempo deste jogo também serão excluídos desta instalação.`,
    );
    if (!confirmed) return;
    try {
      await api.removeGame(game.id);
      setSelectedGame(null);
      setSuccessMessage("Jogo removido da biblioteca.");
      await loadData(activeProfileId ?? undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const updateEmulatorDraft = (system: string, patch: Partial<EmulatorDraft>) => {
    setEmulatorDrafts((current) => ({
      ...current,
      [system]: {
        executablePath: current[system]?.executablePath ?? "",
        launchArguments: current[system]?.launchArguments ?? "{game}",
        ...patch,
      },
    }));
  };

  const handleChooseEmulator = async (system: string) => {
    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        title: `Selecione o executável confiável do emulador para ${system}`,
      });
      if (typeof selectedPath === "string") {
        updateEmulatorDraft(system, { executablePath: selectedPath });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveEmulator = async (system: string) => {
    const draft = emulatorDrafts[system];
    if (!draft?.executablePath) {
      setErrorMessage(`Selecione o executável do emulador para ${system}.`);
      return;
    }
    setErrorMessage("");
    try {
      await api.saveEmulatorConfig({
        system,
        executablePath: draft.executablePath,
        launchArguments: draft.launchArguments,
      });
      setSuccessMessage(`Emulador de ${system} configurado.`);
      await loadData(activeProfileId ?? undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    setSelectedGame(null);
    setErrorMessage("");
  };

  if (isLoading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark large"><Gamepad2 size={29} /></div>
        <div className="loading-label">Preparando sua biblioteca…</div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Gamepad2 size={22} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">arcadia<span>•</span></div>
            <div className="brand-caption">GAME LIBRARY</div>
          </div>
        </div>

        <div className="sidebar-label">ESPAÇO DE JOGO</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <NavButton active={page === "library"} icon={<LibraryBig size={18} />} label="Biblioteca" onClick={() => navigate("library")} />
          <NavButton active={page === "achievements"} icon={<Trophy size={18} />} label="Conquistas" trailing={<span className="nav-count">{unlockedAchievements}</span>} onClick={() => navigate("achievements")} />
          <NavButton active={page === "emulators"} icon={<MonitorCog size={18} />} label="Emuladores" onClick={() => navigate("emulators")} />
          <NavButton active={page === "stats"} icon={<Activity size={18} />} label="Estatísticas" onClick={() => navigate("stats")} />
        </nav>

        <div className="sidebar-divider" />
        <div className="sidebar-label">EM BREVE</div>
        <div className="future-nav-item"><Users size={18} /><span>Amigos</span><span className="soon-label">FUTURO</span></div>
        <div className="future-nav-item"><Swords size={18} /><span>Coop & mods</span><span className="soon-label">FUTURO</span></div>

        <div className="sidebar-spacer" />
        <div className="sidebar-status">
          <span className="status-dot" />
          <div><strong>Modo local</strong><span>Seus dados ficam neste PC</span></div>
          <ShieldCheck size={16} className="status-shield" />
        </div>
        <div className="sidebar-footer">ARCADIA v0.1.0 · BASE MVP</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Arcadia</span><span className="breadcrumb-slash">/</span><strong>{pageTitle(page)}</strong></div>
          <div className="topbar-actions">
            <div className="profile-select-wrap">
              <Users size={16} className="profile-mini-icon" />
              <select
                aria-label="Perfil atual"
                value={activeProfileId ?? ""}
                onChange={(event) => void handleChangeProfile(Number(event.target.value))}
              >
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <ChevronDown size={14} className="select-chevron" />
            </div>
            <button className="icon-button" title="Criar novo perfil" aria-label="Criar novo perfil" onClick={() => setShowAddProfile(true)}><Plus size={18} /></button>
            <div className="avatar-circle">{activeProfile?.name.charAt(0).toLocaleUpperCase("pt-BR") ?? "J"}</div>
          </div>
        </header>

        <div className="page-content">
          {errorMessage && <div className="inline-alert error-alert"><CircleHelp size={17} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} aria-label="Fechar erro"><X size={16} /></button></div>}
          {successMessage && <div className="inline-alert success-alert"><Check size={17} /><span>{successMessage}</span><button onClick={() => setSuccessMessage("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

          {page === "library" && (
            <LibraryPage
              games={filteredGames}
              allGameCount={games.length}
              stats={stats}
              searchQuery={searchQuery}
              systemFilter={systemFilter}
              onSearchChange={setSearchQuery}
              onSystemFilterChange={setSystemFilter}
              onAddGame={() => void handleAddGameClick()}
              onSelectGame={setSelectedGame}
              onLaunch={handleLaunchGame}
              onGoEmulators={() => navigate("emulators")}
            />
          )}
          {page === "achievements" && <AchievementsPage achievements={achievements} onBack={() => navigate("library")} />}
          {page === "emulators" && (
            <EmulatorsPage
              configs={emulatorConfigs}
              drafts={emulatorDrafts}
              onDraftChange={updateEmulatorDraft}
              onChoose={handleChooseEmulator}
              onSave={handleSaveEmulator}
            />
          )}
          {page === "stats" && <StatsPage stats={stats} games={games} achievements={achievements} />}
        </div>
      </main>

      {selectedGame && (
        <GameDetailsModal
          game={games.find((game) => game.id === selectedGame.id) ?? selectedGame}
          onClose={() => setSelectedGame(null)}
          onLaunch={() => void handleLaunchGame(selectedGame)}
          onRemove={() => void handleRemoveGame(selectedGame)}
        />
      )}

      {showAddGame && (
        <Modal title="Adicionar à biblioteca" eyebrow="NOVO JOGO" onClose={() => setShowAddGame(false)}>
          <p className="modal-copy">O Arcadia registra o caminho do arquivo. Ele não fornece nem baixa ROMs.</p>
          <label className="field-label" htmlFor="game-title">Nome do jogo</label>
          <input id="game-title" className="text-input" autoFocus maxLength={120} value={gameTitleDraft} onChange={(event) => setGameTitleDraft(event.target.value)} placeholder="Nome do jogo" />
          <label className="field-label" htmlFor="game-system">Plataforma</label>
          <select id="game-system" className="text-input" value={gameSystemDraft} onChange={(event) => setGameSystemDraft(event.target.value)}>
            {SUPPORTED_SYSTEMS.map((system) => <option key={system} value={system}>{system}</option>)}
          </select>
          <div className="selected-file"><HardDrive size={16} /><span title={gamePathDraft}>{gamePathDraft}</span></div>
          <div className="modal-actions"><button className="button-quiet" onClick={() => setShowAddGame(false)}>Cancelar</button><button className="button-primary" onClick={() => void handleSaveGame()}><Plus size={16} /> Adicionar jogo</button></div>
        </Modal>
      )}

      {showAddProfile && (
        <Modal title="Criar perfil local" eyebrow="NOVO PERFIL" onClose={() => setShowAddProfile(false)}>
          <p className="modal-copy">Cada perfil terá seu próprio tempo de jogo e suas próprias conquistas nesta instalação.</p>
          <label className="field-label" htmlFor="profile-name">Nome do perfil</label>
          <input id="profile-name" className="text-input" autoFocus maxLength={32} value={profileNameDraft} onChange={(event) => setProfileNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleCreateProfile(); }} placeholder="Ex.: Jogador 2" />
          <div className="modal-actions"><button className="button-quiet" onClick={() => setShowAddProfile(false)}>Cancelar</button><button className="button-primary" onClick={() => void handleCreateProfile()}><Plus size={16} /> Criar perfil</button></div>
        </Modal>
      )}

      {errorMessage && (showAddGame || showAddProfile) && (
        <div className="floating-error" role="alert"><CircleHelp size={17} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} aria-label="Fechar erro"><X size={16} /></button></div>
      )}

      {achievementToast && (
        <div className="achievement-toast" role="status">
          <div className="toast-icon"><Trophy size={22} /></div>
          <div className="toast-copy"><span>CONQUISTA DESBLOQUEADA · {achievementToast.rarity.toUpperCase()}</span><strong>{achievementToast.title}</strong><p>{achievementToast.description}</p></div>
          <button onClick={() => setAchievementToast(null)} aria-label="Fechar notificação"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function pageTitle(page: Page): string {
  switch (page) {
    case "library": return "Biblioteca";
    case "achievements": return "Conquistas";
    case "emulators": return "Emuladores";
    case "stats": return "Estatísticas";
  }
}

function NavButton({ active, icon, label, trailing, onClick }: { active: boolean; icon: ReactNode; label: string; trailing?: ReactNode; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{trailing}</button>;
}

function LibraryPage({
  games,
  allGameCount,
  stats,
  searchQuery,
  systemFilter,
  onSearchChange,
  onSystemFilterChange,
  onAddGame,
  onSelectGame,
  onLaunch,
  onGoEmulators,
}: {
  games: GameRecord[];
  allGameCount: number;
  stats: DashboardStats;
  searchQuery: string;
  systemFilter: string;
  onSearchChange: (value: string) => void;
  onSystemFilterChange: (value: string) => void;
  onAddGame: () => void;
  onSelectGame: (game: GameRecord) => void;
  onLaunch: (game: GameRecord) => void;
  onGoEmulators: () => void;
}) {
  return (
    <>
      <section className="welcome-banner">
        <div className="banner-orb orb-one" /><div className="banner-orb orb-two" /><div className="banner-grid" />
        <div className="banner-content">
          <div className="eyebrow"><Sparkles size={14} /> SUA COLEÇÃO, DO SEU JEITO</div>
          <h1>Todo jogo tem<br /><span>uma história.</span></h1>
          <p>Reúna seus clássicos, acompanhe suas horas e volte de onde parou.</p>
          <button className="button-primary banner-button" onClick={onAddGame}><Plus size={17} /> Adicionar jogo</button>
        </div>
        <div className="banner-art" aria-hidden="true"><div className="art-ring ring-a" /><div className="art-ring ring-b" /><div className="art-console"><Gamepad2 size={78} strokeWidth={1.2} /></div><div className="art-star star-a">✦</div><div className="art-star star-b">✧</div></div>
        <div className="banner-footnote"><span className="small-pulse" /> Biblioteca local · Sem ROMs incluídas</div>
      </section>

      <section className="quick-stats">
        <StatMini icon={<LibraryBig size={17} />} label="Na biblioteca" value={String(allGameCount)} tint="violet" />
        <StatMini icon={<Clock3 size={17} />} label="Tempo jogado" value={formatDuration(stats.totalGameSeconds)} tint="cyan" />
        <StatMini icon={<Trophy size={17} />} label="Conquistas" value={String(stats.achievementCount)} tint="amber" />
        <StatMini icon={<Activity size={17} />} label="Jogos iniciados" value={String(stats.playedCount)} tint="pink" />
      </section>

      <section className="library-section">
        <div className="section-heading">
          <div><div className="section-overline">SEU ACERVO</div><h2>Minha biblioteca <span className="subtle-count">{allGameCount}</span></h2></div>
          <button className="button-secondary" onClick={onGoEmulators}><Settings2 size={16} /> Configurar emuladores</button>
        </div>
        <div className="library-toolbar">
          <label className="search-control"><Search size={17} /><input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar jogo ou plataforma…" aria-label="Buscar jogo ou plataforma" />{searchQuery && <button onClick={() => onSearchChange("")} title="Limpar busca"><X size={14} /></button>}</label>
          <div className="filter-select-wrap"><select value={systemFilter} onChange={(event) => onSystemFilterChange(event.target.value)} aria-label="Filtrar por sistema"><option>Todos os sistemas</option>{SUPPORTED_SYSTEMS.map((system) => <option key={system}>{system}</option>)}</select><ChevronDown size={14} /></div>
          <span className="result-count">{games.length} {games.length === 1 ? "jogo" : "jogos"}</span>
        </div>

        {games.length > 0 ? (
          <div className="game-grid">
            {games.map((game, index) => <GameCard key={game.id} game={game} index={index} onClick={() => onSelectGame(game)} onLaunch={() => onLaunch(game)} />)}
          </div>
        ) : allGameCount === 0 ? (
          <div className="empty-library"><div className="empty-icon"><BookOpen size={30} /></div><h3>Sua próxima aventura começa aqui</h3><p>Adicione um arquivo de jogo que você já possui e configure o emulador correspondente para começar.</p><button className="button-primary" onClick={onAddGame}><Plus size={16} /> Adicionar primeiro jogo</button></div>
        ) : (
          <div className="empty-library compact-empty"><div className="empty-icon"><Search size={26} /></div><h3>Nenhum jogo encontrado</h3><p>Tente outro termo ou altere o filtro de plataforma.</p><button className="button-quiet" onClick={() => { onSearchChange(""); onSystemFilterChange("Todos os sistemas"); }}>Limpar filtros</button></div>
        )}
      </section>
    </>
  );
}

function StatMini({ icon, label, value, tint }: { icon: ReactNode; label: string; value: string; tint: string }) {
  return <div className="stat-mini"><div className={`stat-icon ${tint}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>;
}

function GameCard({ game, index, onClick, onLaunch }: { game: GameRecord; index: number; onClick: () => void; onLaunch: () => void }) {
  const styleClass = `cover-style-${index % 6}`;
  const initial = game.title.trim().charAt(0).toLocaleUpperCase("pt-BR") || "G";
  return (
    <article className="game-card">
      <button className={`game-cover ${styleClass}`} onClick={onClick} aria-label={`Ver detalhes de ${game.title}`}>
        <div className="cover-decoration" /><div className="cover-topline"><span>{game.system}</span><ArrowUpRight size={15} /></div><div className="cover-glyph">{initial}</div><div className="cover-title">{game.title}</div><div className="cover-bottom"><span>ARCADIA COLLECTION</span><span className="cover-dot" /></div>
      </button>
      <div className="game-card-info"><button className="game-title-button" onClick={onClick}>{game.title}</button><span className="game-system-label">{game.system}</span><div className="game-card-footer"><span className="game-time"><Clock3 size={13} /> {formatDuration(game.totalSeconds)}</span><button className="play-button" onClick={onLaunch} title={`Iniciar ${game.title}`} aria-label={`Iniciar ${game.title}`}><ArrowUpRight size={16} /></button></div></div>
    </article>
  );
}

function AchievementsPage({ achievements, onBack }: { achievements: Achievement[]; onBack: () => void }) {
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt != null).length;
  return (
    <div className="subpage">
      <div className="page-hero compact-hero"><div className="hero-icon purple"><Trophy size={26} /></div><div><div className="section-overline">PROGRESSO DO JOGADOR</div><h1>Conquistas</h1><p>Pequenos marcos. Grandes histórias.</p></div><div className="achievement-progress"><strong>{unlocked}<span>/{achievements.length}</span></strong><div className="progress-track"><span style={{ width: `${achievements.length ? (unlocked / achievements.length) * 100 : 0}%` }} /></div><small>desbloqueadas</small></div></div>
      <div className="achievement-grid">
        {achievements.map((achievement) => {
          const isUnlocked = achievement.unlockedAt != null;
          return <article className={`achievement-card ${isUnlocked ? "is-unlocked" : "is-locked"}`} key={achievement.code}><div className={`achievement-art rarity-${rarityKey(achievement.rarity)}`}>{achievement.secret && !isUnlocked ? <LockKeyhole size={25} /> : <Trophy size={25} />}</div><div className="achievement-info"><div className="achievement-tags"><span className={`rarity-tag ${rarityKey(achievement.rarity)}`}>{achievement.rarity}</span>{isUnlocked && <span className="unlocked-tag"><Check size={11} /> desbloqueada</span>}</div><h3>{achievement.title}</h3><p>{achievement.description}</p>{isUnlocked && <small>Conquistada em {formatDate(achievement.unlockedAt)}</small>}</div><div className="achievement-status">{isUnlocked ? <BadgeCheck size={19} /> : <LockKeyhole size={17} />}</div></article>;
        })}
      </div>
      <div className="info-strip"><Sparkles size={17} /><p>Estas são conquistas locais do Arcadia. Integrações com conquistas verificadas de jogos serão adicionadas em uma etapa futura e serão identificadas separadamente.</p></div>
      {achievements.length === 0 && <button className="button-quiet" onClick={onBack}><ArrowLeft size={15} /> Voltar à biblioteca</button>}
    </div>
  );
}

function rarityKey(rarity: string): string {
  return rarity.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function EmulatorsPage({ configs, drafts, onDraftChange, onChoose, onSave }: { configs: EmulatorConfig[]; drafts: Record<string, EmulatorDraft>; onDraftChange: (system: string, patch: Partial<EmulatorDraft>) => void; onChoose: (system: string) => void; onSave: (system: string) => void }) {
  const configuredCount = configs.filter((config) => config.configured).length;
  return (
    <div className="subpage">
      <div className="page-hero"><div className="hero-icon cyan"><MonitorCog size={26} /></div><div><div className="section-overline">EXECUÇÃO LOCAL</div><h1>Emuladores</h1><p>Conecte emuladores instalados por você ao Arcadia.</p></div><div className="config-summary"><strong>{configuredCount}<span>/{configs.length}</span></strong><small>configurados</small></div></div>
      <div className="security-note"><ShieldCheck size={18} /><div><strong>Segurança primeiro</strong><p>Escolha apenas executáveis obtidos de fontes confiáveis. O Arcadia não baixa emuladores, BIOS, firmware ou jogos.</p></div></div>
      <div className="emulator-list">
        {configs.map((config) => {
          const draft = drafts[config.system] ?? { executablePath: config.executablePath, launchArguments: config.launchArguments || "{game}" };
          return <article className="emulator-row" key={config.system}><div className={`emulator-system-icon ${config.configured ? "configured" : ""}`}><Gamepad2 size={21} /></div><div className="emulator-main"><div className="emulator-title-line"><h3>{config.system}</h3><span className={`config-pill ${config.configured ? "ready" : "not-ready"}`}><span />{config.configured ? "Configurado" : "Não configurado"}</span></div><div className="path-field"><span title={draft.executablePath}>{draft.executablePath || "Selecione o executável do emulador…"}</span><button className="button-secondary small" onClick={() => onChoose(config.system)}><ArrowDownToLine size={14} /> Procurar</button></div><label className="field-label small-label" htmlFor={`arguments-${config.system}`}>Argumentos de inicialização</label><input id={`arguments-${config.system}`} className="text-input argument-input" value={draft.launchArguments} onChange={(event) => onDraftChange(config.system, { launchArguments: event.target.value })} placeholder={'{game}  ou  --fullscreen "{game}"'} /><p className="field-hint">Use <code>{"{game}"}</code> no local do caminho do jogo. Os argumentos são passados diretamente ao processo, sem shell.</p></div><div className="emulator-row-actions"><button className="button-primary save-config" onClick={() => onSave(config.system)}><Check size={15} /> Salvar</button></div></article>;
        })}
      </div>
    </div>
  );
}

function StatsPage({ stats, games, achievements }: { stats: DashboardStats; games: GameRecord[]; achievements: Achievement[] }) {
  const mostPlayed = [...games].sort((first, second) => second.totalSeconds - first.totalSeconds).slice(0, 5);
  const maxSeconds = Math.max(1, ...mostPlayed.map((game) => game.totalSeconds));
  return (
    <div className="subpage">
      <div className="page-hero"><div className="hero-icon pink"><Activity size={26} /></div><div><div className="section-overline">SEU TEMPO, SEU PROGRESSO</div><h1>Estatísticas</h1><p>Uma visão geral da sua jornada no Arcadia.</p></div></div>
      <div className="stats-dashboard-grid"><StatPanel icon={<Clock3 size={18} />} label="Tempo em jogos" value={formatDuration(stats.totalGameSeconds)} caption="Somado entre os títulos deste perfil" /><StatPanel icon={<Activity size={18} />} label="Tempo no Arcadia" value={formatDuration(stats.totalAppSeconds)} caption="Tempo registrado com o aplicativo aberto" /><StatPanel icon={<Gamepad2 size={18} />} label="Jogos iniciados" value={String(stats.playedCount)} caption={`De ${stats.libraryCount} jogos na biblioteca`} /><StatPanel icon={<Gem size={18} />} label="Conquistas" value={`${stats.achievementCount}/${achievements.length}`} caption="Desbloqueadas neste perfil" /></div>
      <section className="stats-section"><div className="section-heading"><div><div className="section-overline">TOP DA COLEÇÃO</div><h2>Mais jogados</h2></div></div>{mostPlayed.length ? <div className="most-played-list">{mostPlayed.map((game, index) => <div className="most-played-row" key={game.id}><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><div className={`tiny-cover cover-style-${index % 6}`}>{game.title.charAt(0).toUpperCase()}</div><div className="most-played-title"><strong>{game.title}</strong><span>{game.system}</span></div><div className="most-played-bar"><span style={{ width: `${(game.totalSeconds / maxSeconds) * 100}%` }} /></div><span className="most-played-time">{formatDuration(game.totalSeconds)}</span></div>)}</div> : <div className="empty-state-line"><Clock3 size={20} /><span>Seu tempo aparecerá aqui depois de jogar pelo Arcadia.</span></div>}</section>
      <div className="info-strip"><CircleHelp size={17} /><p>O tempo é registrado enquanto o emulador iniciado pelo Arcadia permanece aberto. Sessões interrompidas por travamentos ou encerramentos inesperados podem não ser contabilizadas integralmente.</p></div>
    </div>
  );
}

function StatPanel({ icon, label, value, caption }: { icon: ReactNode; label: string; value: string; caption: string }) {
  return <div className="stat-panel"><div className="stat-panel-top">{icon}<span>{label}</span></div><strong>{value}</strong><small>{caption}</small></div>;
}

function GameDetailsModal({ game, onClose, onLaunch, onRemove }: { game: GameRecord; onClose: () => void; onLaunch: () => void; onRemove: () => void }) {
  return <Modal title={game.title} eyebrow={game.system.toUpperCase()} onClose={onClose} wide><div className="game-detail-layout"><div className={`game-detail-cover cover-style-${Math.abs(game.id) % 6}`}><div className="cover-decoration" /><Gamepad2 size={52} /><strong>{game.title}</strong><span>{game.system}</span></div><div className="game-detail-content"><div className="detail-stat-grid"><div><span>Tempo de jogo</span><strong>{formatDuration(game.totalSeconds)}</strong></div><div><span>Última partida</span><strong>{formatDate(game.lastPlayedAt)}</strong></div><div><span>Adicionado em</span><strong>{formatDate(game.addedAt)}</strong></div></div><div className="detail-path"><HardDrive size={16} /><span title={game.path}>{game.path}</span></div><p className="detail-note">As capas, os vídeos e as informações externas serão integrados em uma próxima etapa. Neste MVP, os dados vêm do arquivo cadastrado.</p><div className="detail-actions"><button className="button-quiet danger-text" onClick={onRemove}><X size={15} /> Remover da biblioteca</button><button className="button-primary" onClick={onLaunch}><Gamepad2 size={17} /> Jogar agora</button></div></div></div></Modal>;
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-panel ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><div className="section-overline">{eyebrow}</div><h2>{title}</h2></div><button className="icon-button close-modal" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>{children}</section></div>;
}

export default App;
