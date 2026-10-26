// Runs inside the mixer page in headless Edge, for guide-images.mjs. Each scene puts the page in the
// state a guide screenshot shows, numbers the parts the guide explains, and returns the area to
// capture. It only changes what's drawn: a fresh headless profile can't open the Volt.
(() => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const icon = (name, template = "#channel-icons") =>
        $(template).content.querySelector(`[data-icon-name="${name}"]`)?.firstElementChild?.cloneNode(true);

    const enable = (root) => {
        for (const control of $$("button, input, select", root)) control.disabled = false;
        for (const slider of $$("[data-slider]", root)) slider.setAttribute("aria-disabled", "false");
    };

    const setSlider = (slider, { position, text }) => {
        slider.parentElement.style.setProperty("--slider-position", String(position));
        const readout = $("[data-slider-value]", slider.parentElement);
        if (readout) readout.textContent = text;
    };

    const setMeter = (meter, fill, name = "shown") => {
        meter.dataset.meter = name;
        meter.style.setProperty("--meter-level", String(fill));
    };

    const press = (element, isOn) => element?.setAttribute("aria-pressed", String(isOn));

    /* The area around some elements, with room for the numbers in the margin. */
    const areaOf = (elements, pad = 16) => {
        const rects = elements.map((element) => element.getBoundingClientRect());
        const left = Math.min(...rects.map((r) => r.left)) - pad;
        const top = Math.min(...rects.map((r) => r.top)) - pad;
        const right = Math.max(...rects.map((r) => r.right)) + pad;
        const bottom = Math.max(...rects.map((r) => r.bottom)) + pad;
        return { x: Math.max(0, left), y: Math.max(0, top), width: right - left, height: bottom - top };
    };

    /* Badge size: set per shot, so the numbers read the same size however much a shot is scaled. */
    let size = 26;

    /* A numbered badge beside an element, matching a numbered list in the guide. */
    const mark = (number, element, side = "left") => {
        // A heading's box runs the full width; its words are what the number points at.
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = element.matches("h2, h3") ? range.getBoundingClientRect() : element.getBoundingClientRect();
        const spots = {
            left: [rect.left - size - 4, rect.top + rect.height / 2 - size / 2],
            right: [rect.right + 4, rect.top + rect.height / 2 - size / 2],
            top: [rect.left + rect.width / 2 - size / 2, rect.top - size - 4],
            bottom: [rect.left + rect.width / 2 - size / 2, rect.bottom + 4],
            corner: [rect.left - size / 2, rect.top - size / 2],
        };
        const [x, y] = spots[side];
        const badge = Object.assign(document.createElement("span"), { textContent: String(number) });
        badge.style.cssText = `position:fixed;left:${x}px;top:${y}px;inline-size:${size}px;block-size:${size}px;
            display:grid;place-items:center;border-radius:50%;z-index:10;
            font:600 ${Math.round(size * 0.58)}px/1 system-ui,sans-serif;
            background:var(--color-background-accent);color:var(--color-text-on-accent);
            box-shadow:0 0 0 2px var(--color-background-surface);`;
        ($("dialog[open]") ?? document.body).append(badge);
    };

    const connected = () => {
        const status = $("[data-status]");
        status.textContent = "Connected · firmware 1.0.3";
        status.dataset.status = "on";
        $("[data-action='connect']").hidden = true;
        $("[data-action='disconnect']").hidden = false;
        $("[data-notice]").replaceChildren();
    };

    const stripOf = (ids) => $(`[data-strips] [data-ids="${ids}"]`);

    /* One strip, as `data` describes it (from guide-images.mjs). */
    const stageStrip = (data) => {
        const strip = stripOf(data.ids);
        if (data.joins) {
            stripOf(data.joins)?.remove();
            strip.dataset.ids = `${data.ids},${data.joins}`;
        }
        $("[data-strip-name]", strip).textContent = data.name;
        if (data.icon) $("[data-strip-icon]", strip).replaceChildren(icon(data.icon));
        if (data.tone) {
            strip.dataset.tone = data.tone.toLowerCase();
            $("[data-strip-tone]", strip).textContent = data.tone;
        }
        press($("[data-strip-action='phantom']", strip), Boolean(data.phantom));
        setSlider($("[data-slider]", strip), data.fader);
        $$("[data-meter]", strip).forEach(
            (meter, i) => data.meters[i] !== undefined && setMeter(meter, data.meters[i]),
        );
        press($("[data-strip-action='mute']", strip), Boolean(data.muted));
        press($("[data-strip-action='solo']", strip), Boolean(data.soloed));
        press($("[data-strip-action='link']", strip), Boolean(data.linked));
        enable(strip);
        if (!data.hasPhantom) $("[data-strip-action='phantom']", strip).disabled = true;
        return strip;
    };

    const stageOutputs = (data) => {
        setSlider($("[data-slider='monitor-level']"), data.monitor);
        setSlider($("[data-slider='headphone-level']"), data.headphone);
        setMeter($("[data-meter='monitorL']"), data.mix[0], "monitorL");
        setMeter($("[data-meter='monitorR']"), data.mix[1], "monitorR");
        enable($(".outputs"));
    };

    const stageMixer = (data) => {
        connected();
        data.strips.forEach(stageStrip);
        stageOutputs(data.outputs);
    };

    const openChannel = (data) => {
        $(`[data-ids="${data.ids}"] [data-strip-action='settings']`).click();
        const dialog = $("#channel-dialog");
        $("[data-dialog-title]", dialog).textContent = `${data.name} settings`;
        $("[data-channel-field='name']", dialog).value = data.name;
        $("[data-channel-icon-current]", dialog).replaceChildren(icon(data.icon));
        setSlider($("[data-slider='gain']", dialog), data.gain);
        press($("[data-channel-action='phantom']", dialog), true);
        $(`input[name='tone'][value='${data.toneIndex}']`, dialog).checked = true;
        for (const name of ["pan-0", "cue1-pan-0", "cue2-pan-0"])
            setSlider($(`[data-slider='${name}']`, dialog), data.pan);
        setSlider($("[data-slider='cue1-level']", dialog), data.send);
        setSlider($("[data-slider='cue2-level']", dialog), data.send);
        $("[data-group-state='cue1']", dialog).textContent = data.send.text;
        $("[data-group-state='cue2']", dialog).textContent = data.send.text;
        enable(dialog);
        return dialog;
    };

    const openSettings = (data) => {
        $("[data-action='open-settings']").click();
        const dialog = $("#settings-dialog");
        $("[data-group='desktop']", dialog).hidden = false;
        $("[data-setting='clip']", dialog).checked = true;
        setSlider($("[data-slider='brightness']", dialog), data.brightness);
        $("[data-setting='show-loopback']", dialog).checked = true;
        $("[data-mix-link]", dialog).value = data.mixLink;
        $("#about-volt-description", dialog).textContent =
            "Firmware 1.0.3, serial ABC1234567. Checked against firmware 1.0.3.";
        for (const key of ["closeToTray", "minimiseToTray", "startAtLogin", "dimOnSleep"])
            $(`[data-desktop='${key}']`, dialog).checked = true;
        $("[data-desktop-login-start]", dialog).hidden = false;
        $("[data-desktop='loginStart'][value='tray']", dialog).checked = true;
        enable(dialog);
        return dialog;
    };

    const group = (dialog, name) => $(`[data-group='${name}']`, dialog);

    window.guideScenes = {
        badge: (pixels) => void (size = pixels),
        overview: (data) => {
            stageMixer(data);
            mark(1, $("[data-status]"), "right");
            mark(2, $("[data-action='disconnect']"), "left");
            mark(3, $("[data-action='open-settings']"), "bottom");
            mark(4, $("#channels-heading"), "right");
            mark(5, $("#outputs-heading"), "right");
            return { x: 0, y: 0, width: innerWidth, height: $(".mixer").getBoundingClientRect().bottom };
        },
        strip: (data) => {
            stageMixer(data);
            const strip = stripOf(data.strips[0].ids);
            for (const other of $$("[data-strip]")) other.style.visibility = other === strip ? "" : "hidden";
            for (const hidden of [$("#channels-heading"), $("footer")]) hidden.style.visibility = "hidden";
            mark(1, $("[data-strip-name]", strip), "top");
            mark(2, $("[data-strip-action='settings']", strip), "right");
            mark(3, $("[data-strip-action='tone']", strip), "left");
            mark(4, $("[data-strip-action='phantom']", strip), "right");
            mark(5, $(".slider", strip), "left");
            mark(6, $(".meters", strip), "right");
            mark(7, $("[data-strip-action='mute']", strip), "left");
            mark(8, $("[data-strip-action='solo']", strip), "bottom");
            mark(9, $("[data-strip-action='link']", strip), "right");
            return areaOf([strip], 36);
        },
        outputs: (data) => {
            stageMixer(data);
            mark(1, $(".outputs .mix"), "left");
            mark(2, $("[data-action='monitor-mute']"), "top");
            mark(3, $("[data-action='monitor-mono']"), "top");
            mark(4, $("[data-slider='monitor-level']"), "left");
            mark(5, $("[data-action='headphone-mute']"), "top");
            return areaOf([$(".outputs")], 32);
        },
        setup: () => {
            connected();
            const panel = $("[data-mix-setup]");
            panel.hidden = false;
            enable(panel);
            return areaOf([panel], 12);
        },
        /* A phone with nothing to carry: what it can do instead. */
        phoneNone: () => {
            const panel = $("[data-carry]");
            panel.hidden = false;
            $("[data-carry-none]").hidden = false;
            $("[data-notice]").replaceChildren();
            return areaOf([panel], 12);
        },
        /*
         * The tray page (src/pages/tray), sent a snapshot the way the app's main process sends one,
         * through the stand-in window.voltTray guide-images.mjs gives it. Its Close button stays
         * hidden, as in a browser. As a phone it has no footer and offers to keep the mix.
         */
        tray: async (data) => {
            window.__showTraySnapshot(data.snapshot);
            while (!$("[data-tray-rows]").children.length) await new Promise(requestAnimationFrame);
            $("[data-tray-close]").hidden = true;
            if (data.isPhone) {
                $(".foot").hidden = true;
                Object.assign($("[data-tray-keep]"), { hidden: false, href: data.snapshot.mixLink });
            }
            return { x: 0, y: 0, width: innerWidth, height: innerHeight };
        },
        /* A phone that opened a mix link: the QR code is drawn here from `data.qr` (src/lib/qr-svg.ts). */
        carry: (data) => {
            const panel = $("[data-carry]");
            panel.hidden = false;
            $("[data-carry-mix]").hidden = false;
            for (const button of $$("[data-carry-share]")) button.hidden = false;
            const svg = $("[data-qr='carry']");
            svg.setAttribute("viewBox", `0 0 ${data.qr.size} ${data.qr.size}`);
            $("path", svg).setAttribute("d", data.qr.path);
            $("[data-notice]").replaceChildren();
            return areaOf([panel], 12);
        },
        channel: (data) => {
            stageMixer(data);
            const dialog = openChannel(data.channel);
            mark(1, $("[data-channel-icon-toggle]", dialog), "left");
            mark(2, $(".slider", group(dialog, "preamp")), "left");
            mark(3, $("[data-channel-action='phantom']", dialog), "left");
            mark(4, $(".tones", dialog), "left");
            mark(5, $("[data-channel-field='auto-gain-seconds']", dialog), "left");
            mark(6, group(dialog, "monitor-mix"), "corner");
            mark(7, group(dialog, "cue1"), "corner");
            return areaOf([dialog], 0);
        },
        cue: (data) => {
            stageMixer(data);
            const dialog = openChannel(data.channel);
            const cue = group(dialog, "cue1");
            cue.open = true;
            return areaOf([cue], 8);
        },
        settings: (data) => {
            stageMixer(data);
            const dialog = openSettings(data.settings);
            return areaOf(
                data.groups.map((name) => group(dialog, name)),
                12,
            );
        },
    };
})();
