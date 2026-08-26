/*
 * RiftLogs retained-DOM diagnostic capture script.
 *
 * Paste this entire file into the browser console on a RiftAtlas spectator
 * page. It scans the retained log, downloads atlas-match.json, and attempts
 * to copy the same JSON to the clipboard.
 */
(async () => {
  const FORMAT = "riftlogs-atlas-dom-capture";
  const FORMAT_VERSION = 1;
  const initialTurnElements = Array.from(
    document.querySelectorAll('[data-match-log-group="turn"]'),
  );

  if (initialTurnElements.length === 0) {
    throw new Error(
      'RiftLogs: no [data-match-log-group="turn"] elements were found.',
    );
  }

  const normalizeRgbKey = (color) => {
    if (!color || color === "transparent") return null;
    const functionMatch = color.match(/rgba?\(([^)]*)\)/i);
    if (!functionMatch) return null;
    const components = functionMatch[1].match(/\d*\.?\d+%?/g);
    if (!components || components.length < 3) return null;

    const alpha = components[3];
    if (alpha) {
      const numericAlpha = Number.parseFloat(alpha);
      const normalizedAlpha = alpha.endsWith("%")
        ? numericAlpha / 100
        : numericAlpha;
      if (normalizedAlpha === 0) return null;
    }

    return components
      .slice(0, 3)
      .map((component) => {
        const numeric = Number.parseFloat(component);
        const channel = component.endsWith("%") ? (numeric / 100) * 255 : numeric;
        return Math.max(0, Math.min(255, Math.round(channel)));
      })
      .join(",");
  };

  const rgbFunctionsFrom = (source) =>
    source.match(/rgba?\([^)]*\)/gi) ?? [];

  const attributesOf = (element) =>
    Object.fromEntries(
      Array.from(element.attributes, ({ name, value }) => [name, value]),
    );

  const snapshotOf = (element) => ({
    tagName: element.tagName.toLowerCase(),
    rawText: element.textContent ?? "",
    visibleText: element.innerText ?? "",
    attributes: attributesOf(element),
    outerHTML: element.outerHTML,
  });

  const includingRoot = (root, selector) => [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];

  const actionElementsOf = (turnElement) => {
    const rows = includingRoot(turnElement, "[data-log-action-kind]")
      .map((marker) => marker.closest("li"))
      .filter((row) => row && row !== turnElement && turnElement.contains(row));
    return [...new Set(rows)];
  };

  const cardsOf = (element) =>
    includingRoot(element, "[data-log-card-name]").map((nameElement) => {
      const container = nameElement.closest("button") ?? nameElement;
      const artElement = container.querySelector("[data-log-card-art]");
      const image = artElement?.querySelector("img");
      const nameAttribute = nameElement.getAttribute("data-log-card-name");
      const artAttribute = artElement?.getAttribute("data-log-card-art") ?? null;

      return {
        ...snapshotOf(container),
        name:
          nameAttribute && nameAttribute !== "true"
            ? nameAttribute
            : nameElement.textContent?.trim() || null,
        art:
          artAttribute && artAttribute !== "true"
            ? artAttribute
            : image?.currentSrc || image?.getAttribute("src") || null,
        ariaLabel: container.getAttribute("aria-label"),
      };
    });

  const battlefieldMarkersOf = (element) =>
    includingRoot(element, "[data-battlefield-marker]").map((markerElement) => {
      const markerAttribute = markerElement.getAttribute(
        "data-battlefield-marker",
      );
      return {
        ...snapshotOf(markerElement),
        marker:
          markerAttribute && markerAttribute !== "true"
            ? markerAttribute
            : markerElement.getAttribute("aria-label") ||
              markerElement.textContent?.trim() ||
              null,
      };
    });

  const paletteColorKeysFrom = (divider) => {
    const keys = new Set();
    const elements = [divider, ...divider.querySelectorAll("*")];

    for (const element of elements) {
      const computed = getComputedStyle(element);
      const sources = [
        element.getAttribute("class") ?? "",
        element.getAttribute("style") ?? "",
        computed.color,
        computed.backgroundColor,
        computed.backgroundImage,
        computed.boxShadow,
        computed.borderColor,
      ];
      for (const source of sources) {
        for (const color of rgbFunctionsFrom(source)) {
          const key = normalizeRgbKey(color);
          if (key) keys.add(key);
        }
      }
    }

    return [...keys];
  };

  const turnIdentityFrom = (turnElement) => {
    const divider = turnElement.querySelector(
      '[data-match-log-turn-divider="true"]',
    );
    const dividerText = divider?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const dividerMatch = dividerText.match(
      /turn\s+(\d+)\s*[·•]\s*(.+)$/i,
    );
    const ariaLabel =
      turnElement.getAttribute("aria-label") ??
      turnElement.querySelector("section[aria-label]")?.getAttribute("aria-label") ??
      null;
    const ariaMatch = ariaLabel?.match(/^turn\s+(\d+)\s*,\s*(.+)$/i);
    const turnNumber = Number(
      dividerMatch?.[1] ??
        turnElement.getAttribute("data-turn-number") ??
        ariaMatch?.[1],
    );

    return {
      turnNumber: Number.isFinite(turnNumber) ? turnNumber : null,
      turnPlayerId: turnElement.getAttribute("data-turn-player-id"),
      turnPlayerName:
        dividerMatch?.[2]?.trim() ?? ariaMatch?.[2]?.trim() ?? null,
      ariaLabel,
      paletteColorKeys: divider ? paletteColorKeysFrom(divider) : [],
    };
  };

  const findActorMarker = (actionRow) =>
    Array.from(actionRow.querySelectorAll("span")).find((span) => {
      const className = span.getAttribute("class") ?? "";
      if (
        className.includes("absolute") &&
        className.includes("left-") &&
        (className.includes("w-[0.1rem]") || className.includes("rounded-full"))
      ) {
        return true;
      }

      const computed = getComputedStyle(span);
      const width = Number.parseFloat(computed.width);
      return (
        computed.position === "absolute" &&
        Number.isFinite(width) &&
        width > 0 &&
        width <= 4
      );
    }) ?? null;

  const actorMarkerColorFrom = (marker) => {
    if (!marker) return null;
    const computedColor = getComputedStyle(marker).backgroundColor;
    if (normalizeRgbKey(computedColor)) return computedColor;

    const classOrStyle = `${marker.getAttribute("class") ?? ""} ${
      marker.getAttribute("style") ?? ""
    }`;
    const backgroundClass = classOrStyle.match(
      /bg-\[(rgba?\([^)]*\))\]/i,
    );
    return backgroundClass?.[1] ?? rgbFunctionsFrom(classOrStyle)[0] ?? null;
  };

  const timestampFrom = (actionElement) =>
    Array.from(actionElement.querySelectorAll("span"))
      .map((element) => element.textContent?.trim() ?? "")
      .find((text) => /^\d{1,2}:\d{2}$/.test(text)) ?? null;

  const withoutTimestamp = (text, timestamp) => {
    if (!timestamp) return text.trim();
    return text.replace(timestamp, "").trim();
  };

  const captureTurn = (turnElement) => {
    const identity = turnIdentityFrom(turnElement);
    const attributes = attributesOf(turnElement);

    return {
      sequence: 0,
      turnNumber: identity.turnNumber,
      turnPlayerId: identity.turnPlayerId,
      turnPlayerName: identity.turnPlayerName,
      turnColorKey: identity.paletteColorKeys[0] ?? null,
      paletteColorKeys: identity.paletteColorKeys,
      ariaLabel: identity.ariaLabel,
      rawText: turnElement.textContent ?? "",
      visibleText: turnElement.innerText ?? "",
      attributes,
      outerHTML: turnElement.outerHTML,
      actions: actionElementsOf(turnElement)
        .reverse()
        .map((actionElement, actionIndex) => {
          const actionTypeMarker = actionElement.querySelector(
            "[data-log-action-kind]",
          );
          const actorMarker = findActorMarker(actionElement);
          const actorMarkerColor = actorMarkerColorFrom(actorMarker);
          const timestamp = timestampFrom(actionElement);
          const rawText = actionElement.textContent ?? "";

          return {
            sequence: 0,
            turnSequence: actionIndex,
            turnNumber: identity.turnNumber,
            turnPlayerName: identity.turnPlayerName,
            turnPlayerId: identity.turnPlayerId,
            actorPlayerName: null,
            actorPlayerId: null,
            actorMarkerColor,
            actorColorKey: normalizeRgbKey(actorMarkerColor),
            actorResolution: "unknown",
            actionType:
              actionTypeMarker?.getAttribute("data-log-action-kind") ?? null,
            actionLabel:
              actionTypeMarker?.getAttribute("data-log-action-label") ?? null,
            text: withoutTimestamp(rawText, timestamp),
            rawHtml: actionElement.outerHTML,
            captureSequence: 0,
            capturedAt: new Date().toISOString(),
            timestamp,
            ...snapshotOf(actionElement),
            cards: cardsOf(actionElement),
            battlefieldMarkers: battlefieldMarkersOf(actionElement),
          };
        }),
    };
  };

  const findScrollableAncestor = (element) => {
    for (
      let candidate = element.parentElement;
      candidate;
      candidate = candidate.parentElement
    ) {
      const style = getComputedStyle(candidate);
      if (
        /auto|scroll/i.test(style.overflowY) &&
        candidate.scrollHeight > candidate.clientHeight + 4
      ) {
        return candidate;
      }
    }
    return null;
  };

  const waitForRender = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 60)),
      ),
    );

  const capturedTurns = new Map();
  const collectVisibleTurns = () => {
    document
      .querySelectorAll('[data-match-log-group="turn"]')
      .forEach((turnElement) => {
        const turn = captureTurn(turnElement);
        const key = `${turn.turnNumber ?? "unknown"}:${
          turn.turnPlayerId ?? turn.turnPlayerName ?? "unknown"
        }`;
        capturedTurns.set(key, turn);
      });
  };

  const scrollContainer = findScrollableAncestor(initialTurnElements[0]);
  if (scrollContainer) {
    const originalScrollTop = scrollContainer.scrollTop;
    scrollContainer.scrollTop = 0;
    await waitForRender();
    collectVisibleTurns();

    let previousScrollTop = -1;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const maximum = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      if (scrollContainer.scrollTop >= maximum - 1) break;
      const step = Math.max(scrollContainer.clientHeight * 0.7, 200);
      scrollContainer.scrollTop = Math.min(maximum, scrollContainer.scrollTop + step);
      await waitForRender();
      collectVisibleTurns();
      if (scrollContainer.scrollTop === previousScrollTop) break;
      previousScrollTop = scrollContainer.scrollTop;
    }

    scrollContainer.scrollTop = originalScrollTop;
    await waitForRender();
  } else {
    collectVisibleTurns();
  }

  const colorToPlayer = new Map();
  const ambiguousColors = new Set();
  for (const turn of capturedTurns.values()) {
    if (!turn.turnPlayerName) continue;
    for (const colorKey of turn.paletteColorKeys) {
      if (ambiguousColors.has(colorKey)) continue;
      const existing = colorToPlayer.get(colorKey);
      const samePlayer = existing
        ? existing.playerId && turn.turnPlayerId
          ? existing.playerId === turn.turnPlayerId
          : existing.playerName === turn.turnPlayerName
        : true;

      if (!samePlayer) {
        colorToPlayer.delete(colorKey);
        ambiguousColors.add(colorKey);
      } else {
        colorToPlayer.set(colorKey, {
          playerId: turn.turnPlayerId,
          playerName: turn.turnPlayerName,
        });
      }
    }
  }

  let captureSequence = 1;
  const turns = [...capturedTurns.values()]
    .sort((left, right) => Number(left.turnNumber) - Number(right.turnNumber))
    .map((turn, turnIndex) => ({
      ...turn,
      sequence: turnIndex,
      actions: turn.actions.map((action, actionIndex) => {
        const actor = action.actorColorKey
          ? colorToPlayer.get(action.actorColorKey)
          : null;
        return {
          ...action,
          sequence: captureSequence,
          turnSequence: actionIndex,
          actorPlayerName: actor?.playerName ?? null,
          actorPlayerId: actor?.playerId ?? null,
          actorResolution: actor ? "color-marker" : "unknown",
          captureSequence: captureSequence++,
        };
      }),
    }));

  const numberedTurns = turns
    .map((turn) => Number(turn.turnNumber))
    .filter(Number.isFinite);
  const firstTurnNumber = numberedTurns.length
    ? Math.min(...numberedTurns)
    : null;
  const completeFromTurnOne = firstTurnNumber === 1;
  if (!completeFromTurnOne) {
    console.warn(
      `RiftLogs: the earliest captured turn is ${firstTurnNumber}. ` +
        "This capture is incomplete; RiftAtlas may have purged older events " +
        "from its 100-event rolling log.",
    );
  }

  const players = [
    ...new Map(
      turns.map((turn) => [
        turn.turnPlayerId ?? turn.turnPlayerName,
        {
          playerId: turn.turnPlayerId,
          playerName: turn.turnPlayerName,
          colorKeys: turn.paletteColorKeys,
        },
      ]),
    ).values(),
  ];
  const capture = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    order: "chronological",
    capturedAt: new Date().toISOString(),
    source: {
      kind: "riftatlas-retained-dom",
      url: location.href,
      pageTitle: document.title,
    },
    captureStatus: {
      completeFromTurnOne,
      firstTurnNumber,
      turnCount: turns.length,
      scannedScrollableLog: Boolean(scrollContainer),
    },
    players,
    turns,
  };

  const json = JSON.stringify(capture, null, 2);
  const blobUrl = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const download = document.createElement("a");
  download.href = blobUrl;
  download.download = "atlas-match.json";
  download.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);

  try {
    await navigator.clipboard.writeText(json);
    console.info(
      `RiftLogs: captured ${turns.length} turns with marker-based ownership.`,
    );
  } catch {
    console.info(
      `RiftLogs: captured ${turns.length} turns. Clipboard access was unavailable.`,
    );
  }

  return capture;
})();
