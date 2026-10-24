use gpui::{Action, actions};

actions!(
    local_studio,
    [
        Quit,
        Refresh,
        FocusFilter,
        LoadModel,
        CopyControllerUrl,
        CopyLogRow,
        SaveLog,
        NextRegion,
        PrevRegion,
        Dismiss,
        ToggleFullscreen,
        ThemeSystem,
        ThemeLight,
        ThemeDark,
        Hide,
        HideOthers,
        ShowAll,
        Minimize,
        CloseWindow
    ]
);

#[derive(Clone, PartialEq, Action)]
#[action(namespace = local_studio, no_json)]
pub struct SelectController(pub usize);

pub struct Binding {
    pub keys: &'static str,
    pub action: fn() -> Box<dyn Action>,
    pub context: Option<&'static str>,
}

const SHELL: Option<&str> = Some("Shell");

pub const BINDINGS: &[Binding] = &[
    Binding {
        keys: "secondary-q",
        action: || Box::new(Quit),
        context: None,
    },
    Binding {
        keys: "secondary-r",
        action: || Box::new(Refresh),
        context: SHELL,
    },
    Binding {
        keys: "secondary-f",
        action: || Box::new(FocusFilter),
        context: SHELL,
    },
    Binding {
        keys: "secondary-l",
        action: || Box::new(LoadModel),
        context: SHELL,
    },
    Binding {
        keys: "secondary-shift-c",
        action: || Box::new(CopyControllerUrl),
        context: SHELL,
    },
    Binding {
        keys: "secondary-c",
        action: || Box::new(CopyLogRow),
        context: Some("Log && !TextField"),
    },
    Binding {
        keys: "secondary-s",
        action: || Box::new(SaveLog),
        context: SHELL,
    },
    Binding {
        keys: "f6",
        action: || Box::new(NextRegion),
        context: SHELL,
    },
    Binding {
        keys: "shift-f6",
        action: || Box::new(PrevRegion),
        context: SHELL,
    },
    Binding {
        keys: "escape",
        action: || Box::new(Dismiss),
        context: Some("Panel"),
    },
    Binding {
        keys: "secondary-1",
        action: || Box::new(SelectController(0)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-2",
        action: || Box::new(SelectController(1)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-3",
        action: || Box::new(SelectController(2)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-4",
        action: || Box::new(SelectController(3)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-5",
        action: || Box::new(SelectController(4)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-6",
        action: || Box::new(SelectController(5)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-7",
        action: || Box::new(SelectController(6)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-8",
        action: || Box::new(SelectController(7)),
        context: SHELL,
    },
    Binding {
        keys: "secondary-9",
        action: || Box::new(SelectController(8)),
        context: SHELL,
    },
];
