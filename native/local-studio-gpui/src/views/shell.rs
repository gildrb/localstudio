use gpui::{
    AnyElement, App, AppContext, Context, Entity, FocusHandle, Focusable, IntoElement, Render,
    Role, SharedString, Window, div, prelude::*, px,
};

use crate::actions::{
    CopyControllerUrl, Dismiss, FocusFilter, LoadModel as LoadModelAction, NextRegion, PrevRegion,
    Refresh, SaveLog, SelectController, ThemeDark, ThemeLight, ThemeSystem,
};
use crate::client::{Fleet, FleetEvent};
use crate::components::button::Button;
use crate::components::card::Card;
use crate::components::focus_ring;
use crate::components::status_mark::{MarkShape, StatusMark, ToneKind};
use crate::components::titlebar::{titlebar, window_frame};
use crate::model::{ControllerView, EngineAction, Status, controller_view};
use crate::platform;
use crate::theme::{
    ActiveTheme, TextRole, TextRoleExt, Theme, ThemeChoice, UI_FONT, radius, size, space,
};
use crate::views::engines::{ConfirmEngine, engines_card};
use crate::views::gpus::gpus_card;
use crate::views::header::header;
use crate::views::load_model::LoadModel;
use crate::views::logs::Logs;
use crate::views::now::now_card;
use crate::views::rail::Rail;
use crate::views::throughput::Throughput;

const COLUMNS: f32 = 12.;
const LEFT_COLUMNS: f32 = 5.;
const TWO_COLUMN_MIN: f32 = 1024.;

pub enum Panel {
    None,
    LoadModel(Entity<LoadModel>),
    Confirm(EngineAction),
}

pub struct Shell {
    fleet: Entity<Fleet>,
    rail: Entity<Rail>,
    logs: Entity<Logs>,
    throughput: Entity<Throughput>,
    panel: Panel,
    focus: FocusHandle,
    regions: [FocusHandle; 5],
    failure: Option<SharedString>,
    title: String,
}

impl Shell {
    pub fn new(fleet: Entity<Fleet>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let rail = cx.new(|cx| Rail::new(fleet.clone(), cx));
        let rail_focus = rail.read(cx).focus.clone();
        let logs = cx.new(|cx| Logs::new(fleet.clone(), window, cx));
        let throughput = cx.new(Throughput::new);
        cx.observe(&throughput, |_, _, cx| cx.notify()).detach();
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        cx.observe(&fleet, |_, _, cx| cx.notify()).detach();
        cx.subscribe(&fleet, |this, _, event: &FleetEvent, cx| match event {
            FleetEvent::Changed => {}
            FleetEvent::ActionFailed { url, error } => {
                this.failure = Some(format!("{url} refused the last action: {error}").into());
                cx.notify();
            }
        })
        .detach();
        cx.observe_window_appearance(window, |_, window, cx| {
            let choice = cx.theme().choice;
            cx.set_global(Theme::new(choice, window.appearance()));
            cx.notify();
        })
        .detach();
        Shell {
            fleet,
            rail,
            logs,
            throughput,
            panel: Panel::None,
            focus,
            regions: std::array::from_fn(|index| match index {
                0 => rail_focus.clone(),
                _ => cx.focus_handle().tab_stop(true),
            }),
            failure: None,
            title: String::new(),
        }
    }

    fn selected_url(&self, cx: &Context<Self>) -> Option<String> {
        self.fleet
            .read(cx)
            .selected()
            .map(|state| state.url.clone())
    }

    fn shown_regions(&self, cx: &Context<Self>) -> Vec<usize> {
        match self.fleet.read(cx).selected().map(controller_view) {
            None => vec![0],
            Some(view) if matches!(view.status, Status::Offline { .. }) => vec![0, 1, 3],
            Some(view) if !view.live_supported => vec![0, 1, 2, 3],
            Some(_) => vec![0, 1, 2, 3, 4],
        }
    }

    fn cycle(&mut self, forward: bool, window: &mut Window, cx: &mut Context<Self>) {
        let shown = self.shown_regions(cx);
        let count = shown.len();
        let current = shown
            .iter()
            .position(|index| self.regions[*index].contains_focused(window, cx));
        let next = match (current, forward) {
            (None, _) => 0,
            (Some(at), true) => (at + 1) % count,
            (Some(at), false) => (at + count - 1) % count,
        };
        window.focus(&self.regions[shown[next]], cx);
    }

    fn set_theme(&mut self, choice: ThemeChoice, window: &mut Window, cx: &mut Context<Self>) {
        cx.set_global(Theme::new(choice, window.appearance()));
        cx.set_menus(platform::menus(choice));
        cx.notify();
    }

    fn close_panel(&mut self, cx: &mut Context<Self>) {
        if matches!(self.panel, Panel::LoadModel(_)) {
            self.fleet
                .update(cx, |fleet, cx| fleet.watch_recipes(false, cx));
        }
        self.panel = Panel::None;
    }

    fn failure_line(&self, failure: SharedString, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors;
        div()
            .id("action-failure")
            .role(Role::Alert)
            .aria_label(failure.clone())
            .flex()
            .items_center()
            .gap(px(space::S2))
            .text_role(TextRole::Body)
            .text_color(colors.err.text)
            .child(StatusMark::new(MarkShape::Cross, ToneKind::Err))
            .child(div().min_w_0().truncate().child(failure))
            .child(
                Button::new("clear-failure", "Dismiss").on_click(cx.listener(|this, _, _, cx| {
                    this.failure = None;
                    cx.notify();
                })),
            )
    }

    fn region(&self, index: usize, child: impl IntoElement, cx: &App) -> gpui::Stateful<gpui::Div> {
        let colors = cx.theme().colors;
        div()
            .id(("region", index))
            .track_focus(&self.regions[index])
            .rounded(px(radius::CARD))
            .focus_visible(move |style| style.shadow(focus_ring(&colors)))
            .child(child)
    }

    fn page(
        &mut self,
        view: &ControllerView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let main = f32::from(window.viewport_size().width) - size::RAIL - 2. * space::S6;
        let gutters = (COLUMNS - 1.) * space::S6;
        let column = ((main - gutters) / COLUMNS).max(0.);
        let left_width = LEFT_COLUMNS * column + (LEFT_COLUMNS - 1.) * space::S6;
        let confirm = match &self.panel {
            Panel::Confirm(action) => Some(action),
            Panel::None | Panel::LoadModel(_) => None,
        };
        let engines = self.region(3, engines_card(view, confirm, &self.fleet, cx), cx);
        if matches!(view.status, Status::Offline { .. }) {
            return div()
                .flex()
                .flex_col()
                .gap(px(space::S6))
                .child(engines)
                .into_any_element();
        }
        let throughput = view.live_supported.then(|| {
            let series = self
                .fleet
                .read(cx)
                .selected()
                .and_then(|state| state.live.as_ref())
                .map(|live| live.series.clone())
                .unwrap_or_default();
            self.throughput.update(cx, |throughput, cx| {
                throughput.render_card(&series, window, cx)
            })
        });
        let now = self.region(2, now_card(view, cx), cx);
        let gpus = gpus_card(view, cx);
        let logs = view
            .live_supported
            .then(|| self.region(4, self.logs.clone(), cx));
        let right: AnyElement = match &self.panel {
            Panel::LoadModel(panel) => panel.clone().into_any_element(),
            Panel::None | Panel::Confirm(_) => div()
                .flex()
                .flex_col()
                .gap(px(space::S6))
                .child(engines)
                .children(logs)
                .into_any_element(),
        };
        if main < TWO_COLUMN_MIN {
            return div()
                .flex()
                .flex_col()
                .gap(px(space::S6))
                .child(now)
                .child(right)
                .child(gpus)
                .children(throughput)
                .into_any_element();
        }
        div()
            .flex()
            .items_start()
            .gap(px(space::S6))
            .child(
                div()
                    .w(px(left_width))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(space::S6))
                    .child(now)
                    .child(gpus)
                    .children(throughput),
            )
            .child(div().flex_1().min_w_0().child(right))
            .into_any_element()
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors;
        let chrome = platform::chrome(window);
        let fleet = self.fleet.read(cx);
        let view = fleet.selected().map(controller_view);
        let empty = fleet.config_error().map_or_else(
            || "No controller configured.".to_string(),
            ToString::to_string,
        );
        let title = view.as_ref().map_or_else(
            || "Local Studio".to_string(),
            |view| format!("{}, Local Studio", view.name),
        );
        if title != self.title {
            window.set_window_title(&title);
            self.title = title;
        }
        let content = match view {
            Some(view) => div()
                .flex()
                .flex_col()
                .gap(px(space::S6))
                .child(self.region(1, header(&view, window, cx), cx))
                .children(
                    self.failure
                        .clone()
                        .map(|failure| self.failure_line(failure, cx)),
                )
                .child(self.page(&view, window, cx))
                .into_any_element(),
            None => Card::new("no-controller", "No controller")
                .child(
                    div()
                        .text_role(TextRole::Body)
                        .text_color(colors.text_secondary)
                        .child(empty),
                )
                .into_any_element(),
        };
        let shell = div()
            .key_context("Shell")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &Refresh, _, cx| {
                this.fleet.update(cx, |fleet, cx| fleet.refresh(cx))
            }))
            .on_action(cx.listener(|this, action: &SelectController, _, cx| {
                let index = action.0;
                this.fleet.update(cx, |fleet, cx| fleet.select(index, cx));
            }))
            .on_action(cx.listener(|this, _: &CopyControllerUrl, _, cx| {
                if let Some(url) = this.selected_url(cx) {
                    platform::copy_text(url, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &LoadModelAction, window, cx| {
                let panel = cx.new(|cx| LoadModel::new(this.fleet.clone(), cx));
                window.focus(&panel.focus_handle(cx), cx);
                this.panel = Panel::LoadModel(panel);
                this.fleet
                    .update(cx, |fleet, cx| fleet.watch_recipes(true, cx));
                cx.notify();
            }))
            .on_action(cx.listener(|this, action: &ConfirmEngine, _, cx| {
                this.close_panel(cx);
                this.panel = Panel::Confirm(action.0.clone());
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &Dismiss, window, cx| {
                this.close_panel(cx);
                window.focus(&this.focus, cx);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &FocusFilter, window, cx| {
                this.logs
                    .update(cx, |logs, cx| logs.focus_filter(window, cx))
            }))
            .on_action(cx.listener(|this, action: &SaveLog, window, cx| {
                this.logs
                    .update(cx, |logs, cx| logs.save(action, window, cx))
            }))
            .on_action(cx.listener(|this, _: &NextRegion, window, cx| this.cycle(true, window, cx)))
            .on_action(
                cx.listener(|this, _: &PrevRegion, window, cx| this.cycle(false, window, cx)),
            )
            .on_action(cx.listener(|this, _: &ThemeSystem, window, cx| {
                this.set_theme(ThemeChoice::System, window, cx)
            }))
            .on_action(cx.listener(|this, _: &ThemeLight, window, cx| {
                this.set_theme(ThemeChoice::Light, window, cx)
            }))
            .on_action(cx.listener(|this, _: &ThemeDark, window, cx| {
                this.set_theme(ThemeChoice::Dark, window, cx)
            }))
            .size_full()
            .flex()
            .flex_col()
            .font_family(UI_FONT)
            .bg(colors.page)
            .text_color(colors.text)
            .children(titlebar(&chrome, "Local Studio".into(), window, cx))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .min_h_0()
                    .child(div().h_full().child(self.rail.clone()))
                    .child(
                        div()
                            .id("main")
                            .role(Role::Main)
                            .flex_1()
                            .min_w_0()
                            .overflow_y_scroll()
                            .p(px(space::S6))
                            .child(content),
                    ),
            );
        window_frame(&chrome, shell.into_any_element(), window, cx)
    }
}
