use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use chrono::{DateTime, Utc};
use gpui::{AppContext, Context, EventEmitter};

use super::config::{ClientConfig, ConfigError, load_config};
use super::demo;
use super::http::{ApiError, Controller};
use super::wire::{Live, LogLine, Recipes, RunRequest, Snapshot};

pub const POLL: Duration = Duration::from_secs(5);
const IN_FLIGHT: usize = 4;
pub(super) const LOG_LINES: usize = 2_000;
const DEMO_ENV: &str = "LOCAL_STUDIO_GPUI_DEMO";

#[derive(Clone, Debug)]
pub enum Reach {
    Connecting,
    Ok,
    Failed {
        error: ApiError,
        since: DateTime<Utc>,
    },
}

pub struct ControllerState {
    pub url: String,
    pub name: Option<String>,
    pub reach: Reach,
    pub snapshot: Option<Snapshot>,
    pub live: Option<Live>,
    pub live_error: Option<ApiError>,
    pub log: VecDeque<LogLine>,
    pub recipes: Option<Recipes>,
    pub recipes_error: Option<ApiError>,
    pub cursor: Option<u64>,
}

pub enum FleetEvent {
    Changed,
    ActionFailed { url: String, error: ApiError },
}

enum Source {
    Controllers(ClientConfig),
    Missing(ConfigError),
    Demo { started: DateTime<Utc>, tick: u64 },
}

pub struct Fleet {
    source: Source,
    controllers: Vec<ControllerState>,
    selected: Option<String>,
    polling: bool,
    watch_recipes: bool,
}

impl EventEmitter<FleetEvent> for Fleet {}

struct Poll {
    url: String,
    name: Option<String>,
    snapshot: Result<Snapshot, ApiError>,
    live: Option<Result<Option<Live>, ApiError>>,
    recipes: Option<Result<Recipes, ApiError>>,
}

struct Target {
    url: String,
    name: Option<String>,
    cursor: Option<u64>,
    recipes: bool,
    snapshot: Option<Result<Snapshot, ApiError>>,
}

impl ControllerState {
    pub fn new(url: String) -> Self {
        ControllerState {
            url,
            name: None,
            reach: Reach::Connecting,
            snapshot: None,
            live: None,
            live_error: None,
            log: VecDeque::new(),
            recipes: None,
            recipes_error: None,
            cursor: None,
        }
    }

    fn merge(&mut self, mut live: Live) {
        let newest = self.log.front().map(|line| line.id);
        let mut lines = std::mem::take(&mut live.log.lines);
        lines.sort_by_key(|line| line.id);
        for line in lines {
            if newest.is_none_or(|id| line.id > id) {
                self.log.push_front(line);
            }
        }
        self.log.truncate(LOG_LINES);
        self.cursor = Some(live.log.cursor);
        self.live = Some(live);
    }

    fn apply(&mut self, poll: Poll, now: DateTime<Utc>) {
        if poll.name.is_some() {
            self.name = poll.name;
        }
        match poll.snapshot {
            Ok(snapshot) => {
                self.reach = Reach::Ok;
                self.snapshot = Some(snapshot);
            }
            Err(error) => {
                let since = match &self.reach {
                    Reach::Failed { since, .. } => *since,
                    Reach::Connecting | Reach::Ok => now,
                };
                self.reach = Reach::Failed { error, since };
            }
        }
        match poll.live {
            Some(Ok(Some(live))) => {
                self.live_error = None;
                self.merge(live);
            }
            Some(Ok(None)) => {
                self.live = None;
                self.live_error = None;
                self.cursor = None;
            }
            Some(Err(error)) => {
                self.live = None;
                self.live_error = Some(error);
            }
            None => {}
        }
        match poll.recipes {
            Some(Ok(recipes)) => {
                self.recipes = Some(recipes);
                self.recipes_error = None;
            }
            Some(Err(error)) => self.recipes_error = Some(error),
            None => {}
        }
    }
}

fn fetch(key: &str, target: Target) -> Poll {
    let controller = Controller::new(target.url.clone(), key.to_string());
    let snapshot = match (target.snapshot, &controller) {
        (Some(snapshot), _) => snapshot,
        (None, Ok(controller)) => controller.snapshot(),
        (None, Err(error)) => Err(error.clone()),
    };
    let (live, recipes) = match (&snapshot, &controller) {
        (Ok(_), Ok(controller)) => (
            Some(controller.live(target.cursor)),
            target.recipes.then(|| controller.recipes(true)),
        ),
        _ => (None, None),
    };
    Poll {
        url: target.url,
        name: target.name,
        snapshot,
        live,
        recipes,
    }
}

fn poll_all(root: String, key: String, peers: Vec<String>, known: Vec<Target>) -> Vec<Poll> {
    let root_snapshot = Controller::new(root.clone(), key.clone()).and_then(|c| c.snapshot());
    let links: Vec<(String, Option<String>)> = match &root_snapshot {
        Ok(snapshot) => snapshot
            .controllers
            .iter()
            .filter(|link| !link.self_)
            .map(|link| (link.url.clone(), link.name.clone()))
            .collect(),
        Err(_) => Vec::new(),
    };
    let mut targets = known;
    let mut root_snapshot = Some(root_snapshot);
    for (url, name) in std::iter::once((root.clone(), None))
        .chain(links)
        .chain(peers.into_iter().map(|url| (url, None)))
    {
        let index = match targets.iter().position(|target| target.url == url) {
            Some(index) => index,
            None => {
                targets.push(Target {
                    url: url.clone(),
                    name: None,
                    cursor: None,
                    recipes: true,
                    snapshot: None,
                });
                targets.len() - 1
            }
        };
        if name.is_some() {
            targets[index].name = name;
        }
        if url == root {
            targets[index].snapshot = root_snapshot.take();
        }
    }
    let count = targets.len();
    let queue = Mutex::new(targets.into_iter().enumerate());
    let results = Mutex::new(Vec::with_capacity(count));
    std::thread::scope(|scope| {
        for _ in 0..IN_FLIGHT.min(count) {
            scope.spawn(|| {
                loop {
                    let item = queue.lock().unwrap_or_else(PoisonError::into_inner).next();
                    let Some((index, target)) = item else { break };
                    let poll = fetch(&key, target);
                    results
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .push((index, poll));
                }
            });
        }
    });
    let mut results = results.into_inner().unwrap_or_else(PoisonError::into_inner);
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, poll)| poll).collect()
}

impl Fleet {
    pub fn new(connect: bool, cx: &mut Context<Self>) -> Self {
        let demo = std::env::var_os(DEMO_ENV).is_some_and(|value| value == "1");
        let source = match (connect, demo) {
            (true, false) => match load_config() {
                Ok(config) => Source::Controllers(config),
                Err(error) => Source::Missing(error),
            },
            (false, _) | (true, true) => Source::Demo {
                started: Utc::now(),
                tick: 0,
            },
        };
        let controllers = match &source {
            Source::Controllers(config) => std::iter::once(config.url.clone())
                .chain(config.peers.iter().cloned())
                .fold(Vec::<ControllerState>::new(), |mut all, url| {
                    if all.iter().all(|state| state.url != url) {
                        all.push(ControllerState::new(url));
                    }
                    all
                }),
            Source::Missing(_) | Source::Demo { .. } => Vec::new(),
        };
        let mut fleet = Fleet {
            source,
            controllers,
            selected: None,
            polling: false,
            watch_recipes: false,
        };
        fleet.refresh(cx);
        if connect {
            cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(POLL).await;
                    if this.update(cx, |fleet, cx| fleet.refresh(cx)).is_err() {
                        break;
                    }
                }
            })
            .detach();
        }
        fleet
    }

    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        match &mut self.source {
            Source::Missing(_) => {}
            Source::Demo { started, tick } => {
                self.controllers = demo::states(*started, *tick);
                *tick += 1;
                cx.emit(FleetEvent::Changed);
                cx.notify();
            }
            Source::Controllers(config) => {
                if self.polling {
                    return;
                }
                self.polling = true;
                let root = config.url.clone();
                let key = config.fleet_key.clone();
                let peers = config.peers.clone();
                let selected = self.selected().map(|state| state.url.clone());
                let watch = self.watch_recipes;
                let known = self
                    .controllers
                    .iter()
                    .map(|state| Target {
                        url: state.url.clone(),
                        name: None,
                        cursor: state.cursor,
                        recipes: state.recipes.is_none()
                            || (watch && selected.as_ref() == Some(&state.url)),
                        snapshot: None,
                    })
                    .collect();
                let task = cx.background_spawn(async move { poll_all(root, key, peers, known) });
                cx.spawn(async move |this, cx| {
                    let polls = task.await;
                    this.update(cx, |fleet, cx| fleet.apply(polls, cx))
                })
                .detach();
            }
        }
    }

    fn apply(&mut self, polls: Vec<Poll>, cx: &mut Context<Self>) {
        let now = Utc::now();
        for poll in polls {
            let index = match self.controllers.iter().position(|s| s.url == poll.url) {
                Some(index) => index,
                None => {
                    self.controllers
                        .push(ControllerState::new(poll.url.clone()));
                    self.controllers.len() - 1
                }
            };
            self.controllers[index].apply(poll, now);
        }
        self.polling = false;
        cx.emit(FleetEvent::Changed);
        cx.notify();
    }

    pub fn select(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(url) = self.controllers.get(index).map(|state| state.url.clone()) else {
            return;
        };
        if self.selected.as_ref() != Some(&url) {
            self.selected = Some(url);
            cx.emit(FleetEvent::Changed);
            cx.notify();
        }
    }

    pub fn watch_recipes(&mut self, watch: bool, cx: &mut Context<Self>) {
        self.watch_recipes = watch;
        if watch {
            self.refresh(cx);
        }
    }

    pub fn controllers(&self) -> &[ControllerState] {
        &self.controllers
    }

    pub fn selected(&self) -> Option<&ControllerState> {
        self.selected
            .as_ref()
            .and_then(|url| self.controllers.iter().find(|state| &state.url == url))
            .or(self.controllers.first())
    }

    pub fn selected_index(&self) -> Option<usize> {
        let url = &self.selected()?.url;
        self.controllers.iter().position(|state| &state.url == url)
    }

    pub fn config_error(&self) -> Option<&ConfigError> {
        match &self.source {
            Source::Missing(error) => Some(error),
            Source::Controllers(_) | Source::Demo { .. } => None,
        }
    }

    fn act(
        &mut self,
        url: Option<String>,
        cx: &mut Context<Self>,
        call: impl FnOnce(&Controller) -> Result<(), ApiError> + Send + 'static,
    ) {
        let Some(url) = url else { return };
        let key = match &self.source {
            Source::Controllers(config) => config.fleet_key.clone(),
            Source::Missing(_) => {
                cx.emit(FleetEvent::ActionFailed {
                    url,
                    error: ApiError::Unreachable(
                        "No controller configured, nothing was sent.".to_string(),
                    ),
                });
                return;
            }
            Source::Demo { .. } => {
                cx.emit(FleetEvent::ActionFailed {
                    url,
                    error: ApiError::Unreachable("Demo data, nothing was sent.".to_string()),
                });
                return;
            }
        };
        let target = url.clone();
        let task = cx.background_spawn(async move {
            Controller::new(target, key).and_then(|controller| call(&controller))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |fleet, cx| {
                match result {
                    Ok(()) => {
                        if let Some(state) = fleet.controllers.iter_mut().find(|s| s.url == url) {
                            state.recipes = None;
                        }
                    }
                    Err(error) => cx.emit(FleetEvent::ActionFailed { url, error }),
                }
                fleet.refresh(cx);
            })
        })
        .detach();
    }

    fn selected_url(&self) -> Option<String> {
        self.selected().map(|state| state.url.clone())
    }

    pub fn load(&mut self, recipe_id: String, replace: bool, cx: &mut Context<Self>) {
        let request = RunRequest {
            replace: replace.then_some(true),
            ..RunRequest::default()
        };
        self.act(self.selected_url(), cx, move |controller| {
            controller.run_recipe(&recipe_id, &request).map(|_| ())
        });
    }

    pub fn stop_port(&mut self, port: u16, cx: &mut Context<Self>) {
        self.act(self.selected_url(), cx, move |controller| {
            controller.stop_port(port)
        });
    }

    pub fn cancel_job(&mut self, job_id: String, cx: &mut Context<Self>) {
        self.act(self.selected_url(), cx, move |controller| {
            controller.stop_run(&job_id)
        });
    }

    pub fn add_peer(&mut self, url: String, cx: &mut Context<Self>) {
        let root = match &self.source {
            Source::Controllers(config) => Some(config.url.clone()),
            Source::Missing(_) | Source::Demo { .. } => self.selected_url(),
        };
        self.act(root, cx, move |controller| {
            controller.add_peer(&url).map(|_| ())
        });
    }
}
