use gpui::{
    AnyElement, App, Bounds, BoxShadow, ClickEvent, CursorStyle, ElementId, HitboxBehavior,
    MouseButton, Pixels, Point, ResizeEdge, Role, SharedString, Size, Tiling, Window,
    WindowControlArea, canvas, div, hsla, point, prelude::*, px, svg,
};

use crate::components::{HAIRLINE, focus_ring};
use crate::platform::{self, Chrome, Decor};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space};

const SHADOW: f32 = space::S2;

fn control(
    id: &'static str,
    label: &'static str,
    area: WindowControlArea,
    icon: AnyElement,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    cx: &App,
) -> impl IntoElement {
    let c = cx.theme().colors;
    div()
        .id(ElementId::from(id))
        .group(id)
        .role(Role::Button)
        .aria_label(label)
        .tab_index(0)
        .window_control_area(area)
        .size(px(size::CONTROL))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(radius::CONTROL))
        .hover(|style| style.bg(c.hover))
        .active(|style| style.bg(c.selected))
        .focus_visible(|style| style.shadow(focus_ring(&c)))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(on_click)
        .child(icon)
}

fn icon(path: &'static str, group: &'static str, cx: &App) -> AnyElement {
    let c = cx.theme().colors;
    svg()
        .path(path)
        .size(px(size::ICON))
        .text_color(c.text_secondary)
        .group_hover(group, move |style| style.text_color(c.text))
        .into_any_element()
}

pub fn titlebar(
    chrome: &Chrome,
    title: SharedString,
    window: &Window,
    cx: &App,
) -> Option<AnyElement> {
    if chrome.titlebar_height <= 0. {
        return None;
    }
    let c = cx.theme().colors;
    let controls = match chrome.decor {
        Decor::ClientDrawn { controls, .. } => Some(controls),
        Decor::Native => None,
    };
    let client = controls.is_some();
    let maximized = window.is_maximized();
    Some(
        div()
            .id("titlebar")
            .h(px(chrome.titlebar_height))
            .w_full()
            .flex()
            .flex_none()
            .items_center()
            .pl(px(chrome.leading_inset + space::S2))
            .pr(px(space::S1))
            .bg(c.surface)
            .border_b_1()
            .border_color(c.divider)
            .child(
                div()
                    .id("titlebar-drag")
                    .flex_1()
                    .h_full()
                    .flex()
                    .items_center()
                    .window_control_area(WindowControlArea::Drag)
                    .when(chrome.movable, |this| {
                        this.on_mouse_down(MouseButton::Left, |event, window, _| {
                            if event.click_count == 2 {
                                platform::titlebar_double_click(window);
                            } else {
                                window.start_window_move();
                            }
                        })
                    })
                    .when(client, |this| {
                        this.on_mouse_down(MouseButton::Right, |event, window, _| {
                            window.show_window_menu(event.position)
                        })
                    })
                    .text_role(TextRole::Label)
                    .text_color(c.text)
                    .child(title),
            )
            .children(controls.map(|controls| {
                div()
                    .flex()
                    .gap(px(space::S1))
                    .when(controls.minimize, |this| {
                        this.child(control(
                            "minimize",
                            "Minimize",
                            WindowControlArea::Min,
                            div()
                                .w(px(space::S3))
                                .h(px(size::FOCUS))
                                .bg(c.text_secondary)
                                .group_hover("minimize", move |style| style.bg(c.text))
                                .into_any_element(),
                            |_, window, _| window.minimize_window(),
                            cx,
                        ))
                    })
                    .when(controls.maximize, |this| {
                        this.child(control(
                            "maximize",
                            if maximized { "Restore" } else { "Maximize" },
                            WindowControlArea::Max,
                            icon("icons/square.svg", "maximize", cx),
                            |_, window, _| window.zoom_window(),
                            cx,
                        ))
                    })
                    .child(control(
                        "close",
                        "Close",
                        WindowControlArea::Close,
                        icon("icons/x.svg", "close", cx),
                        |_, window, _| window.remove_window(),
                        cx,
                    ))
            }))
            .into_any_element(),
    )
}

fn resize_edge(at: Point<Pixels>, window: Size<Pixels>, tiling: Tiling) -> Option<ResizeEdge> {
    let inset = px(SHADOW);
    let top = !tiling.top && at.y < inset;
    let bottom = !tiling.bottom && at.y > window.height - inset;
    let left = !tiling.left && at.x < inset;
    let right = !tiling.right && at.x > window.width - inset;
    match (top, bottom, left, right) {
        (true, _, true, _) => Some(ResizeEdge::TopLeft),
        (true, _, _, true) => Some(ResizeEdge::TopRight),
        (_, true, true, _) => Some(ResizeEdge::BottomLeft),
        (_, true, _, true) => Some(ResizeEdge::BottomRight),
        (true, _, _, _) => Some(ResizeEdge::Top),
        (_, true, _, _) => Some(ResizeEdge::Bottom),
        (_, _, true, _) => Some(ResizeEdge::Left),
        (_, _, _, true) => Some(ResizeEdge::Right),
        _ => None,
    }
}

fn cursor(edge: ResizeEdge) -> CursorStyle {
    match edge {
        ResizeEdge::Top | ResizeEdge::Bottom => CursorStyle::ResizeUpDown,
        ResizeEdge::Left | ResizeEdge::Right => CursorStyle::ResizeLeftRight,
        ResizeEdge::TopLeft | ResizeEdge::BottomRight => CursorStyle::ResizeUpLeftDownRight,
        ResizeEdge::TopRight | ResizeEdge::BottomLeft => CursorStyle::ResizeUpRightDownLeft,
    }
}

pub fn window_frame(
    chrome: &Chrome,
    content: AnyElement,
    window: &mut Window,
    cx: &App,
) -> AnyElement {
    let Decor::ClientDrawn { tiling, .. } = chrome.decor else {
        window.set_client_inset(px(0.));
        return content;
    };
    window.set_client_inset(px(SHADOW));
    let c = cx.theme().colors;
    let corner = px(radius::CARD);
    let edges = canvas(
        |_, window, _| {
            let size = window.window_bounds().get_bounds().size;
            window.insert_hitbox(
                Bounds::new(point(px(0.), px(0.)), size),
                HitboxBehavior::Normal,
            )
        },
        move |_, hitbox, window, _| {
            let size = window.window_bounds().get_bounds().size;
            if let Some(edge) = resize_edge(window.mouse_position(), size, tiling) {
                window.set_cursor_style(cursor(edge), &hitbox);
            }
        },
    )
    .size_full()
    .absolute();
    div()
        .id("window-frame")
        .size_full()
        .when(!tiling.top, |this| this.pt(px(SHADOW)))
        .when(!tiling.bottom, |this| this.pb(px(SHADOW)))
        .when(!tiling.left, |this| this.pl(px(SHADOW)))
        .when(!tiling.right, |this| this.pr(px(SHADOW)))
        .child(edges)
        .on_mouse_move(|_, window, _| window.refresh())
        .on_mouse_down(MouseButton::Left, move |event, window, _| {
            let size = window.window_bounds().get_bounds().size;
            if let Some(edge) = resize_edge(event.position, size, tiling) {
                window.start_window_resize(edge);
            }
        })
        .child(
            div()
                .id("window-surface")
                .size_full()
                .overflow_hidden()
                .cursor(CursorStyle::Arrow)
                .border_color(c.frame)
                .when(!(tiling.top || tiling.left), |this| this.rounded_tl(corner))
                .when(!(tiling.top || tiling.right), |this| {
                    this.rounded_tr(corner)
                })
                .when(!(tiling.bottom || tiling.left), |this| {
                    this.rounded_bl(corner)
                })
                .when(!(tiling.bottom || tiling.right), |this| {
                    this.rounded_br(corner)
                })
                .when(!tiling.top, |this| this.border_t(px(HAIRLINE)))
                .when(!tiling.bottom, |this| this.border_b(px(HAIRLINE)))
                .when(!tiling.left, |this| this.border_l(px(HAIRLINE)))
                .when(!tiling.right, |this| this.border_r(px(HAIRLINE)))
                .when(!tiling.is_tiled(), |this| {
                    this.shadow(vec![BoxShadow {
                        color: hsla(0., 0., 0., 0.4),
                        offset: point(px(0.), px(0.)),
                        blur_radius: px(SHADOW / 2.),
                        spread_radius: px(0.),
                        inset: false,
                    }])
                })
                .on_mouse_move(|_, _, cx| cx.stop_propagation())
                .child(content),
        )
        .into_any_element()
}
