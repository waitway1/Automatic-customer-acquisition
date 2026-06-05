from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - config-only runs can still use row hints.
    requests = None
    BeautifulSoup = None


@dataclass
class OutreachCustomer:
    company: str = ""
    website: str = ""
    email: str = ""
    country: str = ""
    title: str = ""
    row_index: int = 0


BUSINESS_TYPE_RULES: list[tuple[str, list[str]]] = [
    ("canopy_topper", ["canopy", "hardtop", "tonneau", "lid", "cover", "topper", "bed cap", "capotas"]),
    ("suspension", ["suspension", "shock", "absorber", "damper", "lift kit", "coilover", "spring"]),
    ("bullbar_protection", ["bull bar", "nudge bar", "bash plate", "skid plate", "roo bar", "protection", "bumper"]),
    ("lighting", ["light bar", "led", "headlight", "driving light", "spotlight", "fog light", "work light"]),
    ("styling_exterior", ["body kit", "fender flare", "grille", "grill", "spoiler", "side step", "running board", "flares", "styling", "exterior"]),
    ("recovery", ["winch", "recovery", "tow", "strap", "snorkel", "jack"]),
    ("4x4_accessories", ["4x4", "off-road", "offroad", "overland", "expedition", "adventure", "trail"]),
    ("pickup_general", ["pickup", "ute", "truck", "tray", "ute tray", "flat tray", "bed liner"]),
    ("auto_parts", ["auto parts", "aftermarket", "spare parts", "repuestos", "acessorios", "accessories", "parts"]),
]

BRAND_TOKENS = [
    "ranger", "raptor", "hilux", "amarok", "navara", "l200", "triton", "d-max",
    "bt-50", "colorado", "tacoma", "f-150", "silverado", "ram", "toyota", "ford",
    "isuzu", "nissan", "mitsubishi", "holden", "chevrolet", "suzuki", "jeep",
    "land cruiser", "prado", "patrol", "everest", "fortuner", "santa fe",
    "santafe", "jetour", "byd", "shark",
]

DEFAULT_PRODUCT_LINES: list[dict[str, Any]] = [
    {
        "id": "raptor_body_kit",
        "name": "Raptor style body kit",
        "keywords": ["body kit", "raptor", "styling", "fender", "flare", "appearance", "exterior"],
        "angle": "full exterior transformation",
        "signals": ["styling", "body", "raptor"],
        "business_types": ["styling_exterior", "auto_parts"],
    },
    {
        "id": "front_grille_led",
        "name": "front grille with LED",
        "keywords": ["grille", "grill", "front end", "led", "light", "bumper"],
        "angle": "front-end styling upgrade",
        "signals": ["styling", "lighting", "raptor"],
        "business_types": ["lighting", "styling_exterior"],
    },
    {
        "id": "wide_wheel_arch",
        "name": "wide wheel arch flares",
        "keywords": ["fender flare", "flare", "wheel arch", "wide", "mud flap", "wheel"],
        "angle": "wider stance and arch coverage",
        "signals": ["styling", "body", "offroad"],
        "business_types": ["styling_exterior", "4x4_accessories"],
    },
    {
        "id": "bull_bar",
        "name": "bull bar",
        "keywords": ["bull bar", "nudge bar", "bumper", "guard", "protection", "armor"],
        "angle": "off-road protection",
        "signals": ["offroad", "protection"],
        "business_types": ["bullbar_protection", "4x4_accessories"],
    },
    {
        "id": "roof_light_pods",
        "name": "roof light pods kit",
        "keywords": ["roof light", "light pod", "led", "spotlight", "driving light", "work light"],
        "angle": "lighting and utility upgrade",
        "signals": ["lighting", "offroad"],
        "business_types": ["lighting", "4x4_accessories"],
    },
    {
        "id": "bonnet_scoop",
        "name": "bonnet scoop",
        "keywords": ["bonnet", "hood", "scoop", "styling", "front"],
        "angle": "bonnet styling upgrade",
        "signals": ["styling", "body"],
        "business_types": ["styling_exterior"],
    },
    {
        "id": "rear_spoiler",
        "name": "rear spoiler",
        "keywords": ["rear", "spoiler", "tailgate", "back panel"],
        "angle": "rear-end styling",
        "signals": ["styling", "body"],
        "business_types": ["styling_exterior"],
    },
    {
        "id": "snorkel",
        "name": "snorkel",
        "keywords": ["snorkel", "water crossing", "intake", "offroad", "4x4"],
        "angle": "off-road utility",
        "signals": ["offroad", "utility"],
        "business_types": ["recovery", "4x4_accessories"],
    },
    {
        "id": "tailgate",
        "name": "tailgate upgrade",
        "keywords": ["tailgate", "rear", "back panel", "bed", "cargo"],
        "angle": "rear utility and styling",
        "signals": ["utility", "pickup", "body"],
        "business_types": ["pickup_general", "styling_exterior"],
    },
    {
        "id": "fog_light",
        "name": "fog light",
        "keywords": ["fog light", "led", "lighting", "front light"],
        "angle": "lighting upgrade",
        "signals": ["lighting"],
        "business_types": ["lighting"],
    },
    {
        "id": "waterproof_tool_bag",
        "name": "camouflage waterproof tooling bag",
        "keywords": ["tool bag", "waterproof", "cargo", "utility", "storage", "bag"],
        "angle": "practical cargo accessory",
        "signals": ["utility", "accessories", "pickup"],
        "business_types": ["pickup_general", "auto_parts"],
    },
]


def normalize(value: Any) -> str:
    text = html.unescape(str(value or "")).strip()
    return re.sub(r"\s+", " ", text)


def lower_text(value: Any) -> str:
    return normalize(value).lower()


def get_domain(url: str) -> str:
    value = normalize(url)
    if not value:
        return ""
    candidate = value if "://" in value else f"https://{value}"
    try:
        domain = urlparse(candidate).netloc.lower()
    except Exception:
        return ""
    return domain[4:] if domain.startswith("www.") else domain


def _customer_value(customer: Any, key: str, default: str = "") -> str:
    if customer is None:
        return default
    if isinstance(customer, Mapping):
        return normalize(customer.get(key, default))
    return normalize(getattr(customer, key, default))


def _fetch_homepage(domain: str, original_url: str = "") -> tuple[str, str]:
    if not domain or requests is None:
        return "", ""
    candidates = []
    original = normalize(original_url)
    if original:
        candidates.append(original if "://" in original else f"https://{original}")
    candidates.extend([f"https://{domain}", f"http://{domain}"])
    for candidate in dict.fromkeys(candidates):
        try:
            response = requests.get(candidate, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            if response.ok and response.text:
                return response.text[:300000], response.url
        except Exception:
            continue
    return "", ""


def _extract_site_text(html_text: str) -> tuple[str, str, str]:
    if not html_text or BeautifulSoup is None:
        return "", "", ""
    soup = BeautifulSoup(html_text, "html.parser")
    title = normalize(soup.title.text) if soup.title and soup.title.text else ""
    meta = soup.find("meta", attrs={"name": "description"})
    description = normalize(meta.get("content")) if meta and meta.get("content") else ""
    body = normalize(soup.get_text(" ", strip=True))[:16000]
    return title, description, body


def _extract_products(text: str) -> list[str]:
    lower = lower_text(text)
    found: list[str] = []
    for _, keywords in BUSINESS_TYPE_RULES:
        for keyword in keywords:
            if keyword in lower and keyword not in found:
                found.append(keyword)
    return found[:18]


def _extract_brands(text: str) -> list[str]:
    lower = lower_text(text)
    return [brand for brand in BRAND_TOKENS if brand in lower][:10]


def analyze_site(
    website: str,
    *,
    company: str = "",
    title: str = "",
    country: str = "",
    summary: str = "",
    task: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    domain = get_domain(website)
    html_text, final_url = _fetch_homepage(domain, website)
    fetched_title, description, body = _extract_site_text(html_text)
    title_value = normalize(title) or fetched_title
    merged = lower_text(f"{domain} {company} {title_value} {country} {summary} {description} {body}")

    has_vehicle_context = any(
        token in merged
        for token in (
            "pickup", "ute", "truck", "4x4", "off-road", "offroad", "overland",
            "ranger", "hilux", "amarok", "navara", "triton", "d-max", "bt-50",
            "tacoma", "f-150", "raptor", "suv", "vehicle", "accessories", "parts",
        )
    )
    signals = {
        "ranger": any(token in merged for token in ("ranger", "ford ranger")),
        "raptor": "raptor" in merged,
        "offroad": any(token in merged for token in ("4x4", "off-road", "offroad", "overland", "recovery", "lift kit", "trail")),
        "styling": any(token in merged for token in ("styling", "body kit", "fender flare", "flare", "grille", "grill", "spoiler", "appearance", "exterior")),
        "pickup": any(token in merged for token in ("pickup", "ute", "truck", "tray", "canopy", "hardtop", "tonneau", "bed liner")),
        "accessories": any(token in merged for token in ("accessories", "parts", "aftermarket", "auto parts")),
        "body": any(token in merged for token in ("body kit", "grille", "grill", "spoiler", "bonnet", "wheel arch", "flare", "tailgate")),
        "lighting": any(token in merged for token in ("light bar", "led", "spotlight", "fog light", "roof light", "driving light")),
        "protection": any(token in merged for token in ("bull bar", "bumper", "guard", "protection", "armor", "bash plate", "skid plate")),
        "utility": any(token in merged for token in ("cargo", "tool box", "tool bag", "storage", "bed", "tray", "utility")),
    }

    business_type = "unknown"
    for rule_name, keywords in BUSINESS_TYPE_RULES:
        if any(keyword in merged for keyword in keywords):
            if rule_name in {"canopy_topper", "suspension"} and not has_vehicle_context:
                continue
            business_type = rule_name
            break

    labels = {
        "canopy_topper": "canopy and hardtop products",
        "suspension": "suspension and ride upgrades",
        "bullbar_protection": "bull bars and vehicle protection",
        "lighting": "LED lighting and driving lights",
        "styling_exterior": "exterior styling and body upgrades",
        "recovery": "recovery gear and off-road accessories",
        "4x4_accessories": "4x4 and overland accessories",
        "pickup_general": "pickup truck accessories",
        "auto_parts": "aftermarket auto parts",
    }
    direction_parts = []
    if business_type in labels:
        direction_parts.append(labels[business_type])
    if signals["ranger"]:
        direction_parts.append("Ford Ranger")
    elif signals["raptor"]:
        direction_parts.append("Raptor-style upgrades")
    elif signals["pickup"]:
        direction_parts.append("pickup trucks")

    return {
        "domain": domain,
        "title": title_value,
        "business_type": business_type,
        "main_direction": ", ".join(direction_parts[:3]) or "vehicle accessories",
        "specific_products": _extract_products(merged),
        "brands_mentioned": _extract_brands(merged),
        "signals": signals,
        "final_url": final_url,
        "text_excerpt": normalize(f"{summary} {description} {body}")[:3000],
        "search_text": merged[:24000],
    }


def fetch_site_info(url: str, *, task: Mapping[str, Any] | None = None, **hints: Any) -> dict[str, Any]:
    return analyze_site(url, task=task, **hints)


def _configured_product_lines(task: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if task and task.get("product_lines"):
        return [dict(item) for item in task["product_lines"]]
    lines = [dict(item) for item in DEFAULT_PRODUCT_LINES]
    product_name = normalize((task or {}).get("product_name") or (task or {}).get("product_focus"))
    if product_name and not any(lower_text(item["name"]) == lower_text(product_name) for item in lines):
        words = [word for word in re.split(r"[^a-z0-9]+", product_name.lower()) if len(word) > 2]
        lines.insert(
            0,
            {
                "id": "task_product",
                "name": product_name,
                "keywords": words,
                "angle": normalize((task or {}).get("campaign_angle")) or "product-specific upgrade",
                "signals": [],
                "business_types": [],
            },
        )
    return lines


def _score_product(line: Mapping[str, Any], site_info: Mapping[str, Any], task: Mapping[str, Any] | None) -> int:
    text = lower_text(site_info.get("search_text", ""))
    specific = [lower_text(item) for item in site_info.get("specific_products", [])]
    signals = site_info.get("signals", {})
    business_type = site_info.get("business_type", "unknown")
    task_text = lower_text(
        " ".join(
            str((task or {}).get(key, ""))
            for key in ("product_name", "product_focus", "product_family", "campaign_angle", "vehicle_model")
        )
    )
    score = 0
    for keyword in line.get("keywords", []):
        keyword_l = lower_text(keyword)
        if not keyword_l:
            continue
        if any(keyword_l in item for item in specific):
            score += 6
        if keyword_l in text:
            score += 2
        if keyword_l in task_text:
            score += 12
    for signal in line.get("signals", []):
        if signals.get(signal):
            score += 4
    if business_type in line.get("business_types", []):
        score += 5
    if lower_text(line.get("name")) in task_text:
        score += 14
    return score


def choose_products(site_info: Mapping[str, Any], task: Mapping[str, Any] | None = None) -> dict[str, Any]:
    lines = _configured_product_lines(task)
    ranked = sorted(lines, key=lambda item: _score_product(item, site_info, task), reverse=True)
    max_products = int((task or {}).get("max_products", 3) or 3)
    selected = ranked[:max(1, min(max_products, 3))]
    top_score = _score_product(selected[0], site_info, task) if selected else 0

    if top_score <= 0:
        signals = site_info.get("signals", {})
        if signals.get("offroad") or signals.get("protection"):
            preferred = {"bull_bar", "roof_light_pods", "wide_wheel_arch", "snorkel"}
        elif signals.get("styling") or signals.get("body") or signals.get("raptor") or signals.get("ranger"):
            preferred = {"raptor_body_kit", "front_grille_led", "wide_wheel_arch", "bonnet_scoop", "rear_spoiler"}
        elif signals.get("utility") or signals.get("pickup") or signals.get("accessories"):
            preferred = {"waterproof_tool_bag", "tailgate", "roof_light_pods"}
        else:
            preferred = {"raptor_body_kit", "front_grille_led", "bull_bar"}
        selected = [line for line in lines if line.get("id") in preferred][:max_products] or ranked[:max_products]

    vehicle = normalize((task or {}).get("vehicle_model")) or "Ford Ranger T9"
    item_names = [normalize(item.get("name")) for item in selected if normalize(item.get("name"))]
    primary = item_names[0] if item_names else normalize((task or {}).get("product_name")) or "upgrade products"
    angle = normalize(selected[0].get("angle")) if selected else normalize((task or {}).get("campaign_angle"))
    angle = angle or "exterior and accessory upgrade"
    product_family = normalize((task or {}).get("product_family"))
    if product_family:
        phrase = product_family
    elif "body" in angle or "styling" in angle or "exterior" in angle:
        phrase = f"{vehicle} exterior and styling products"
    elif "off-road" in angle or "protection" in angle:
        phrase = f"{vehicle} off-road and protection parts"
    else:
        phrase = f"{vehicle} accessory and upgrade products"

    return {
        "angle": angle,
        "phrase": phrase,
        "primary_product": primary,
        "items": item_names[:3],
        "business_type": site_info.get("business_type", "unknown"),
        "customer_brands": site_info.get("brands_mentioned", []),
        "ranger_focus": bool(site_info.get("signals", {}).get("ranger")),
        "vehicle_model": vehicle,
        "price_hint": normalize((task or {}).get("price_hint")),
    }


def greeting(company: str, variant_index: int) -> str:
    company = normalize(company)
    short = company[:42].strip(" ,-")
    if short and variant_index % 4 != 3:
        options = [
            f"Hello {short} team,",
            f"Hi {short} team,",
            f"Good day {short} team,",
            f"Dear {short} team,",
        ]
    else:
        options = ["Hello,", "Hi there,", "Good day,", "Hello team,"]
    return options[variant_index % len(options)]


def _ref_site(customer: Any, site_info: Mapping[str, Any]) -> str:
    title = normalize(site_info.get("title"))
    domain = normalize(site_info.get("domain"))
    generic_titles = ("home", "homepage", "shop", "store", "contact", "about", "products")
    if title and len(title) <= 70 and not any(title.lower() == value for value in generic_titles):
        return f"your site, {title}"
    if domain:
        return f"your site ({domain})"
    company = _customer_value(customer, "company")
    return company or "your website"


def _region_word(country: str) -> str:
    text = lower_text(country)
    mapping = {
        "australia": "the Australian",
        "new zealand": "the New Zealand",
        "south africa": "the South African",
        "united kingdom": "the UK",
        "uk": "the UK",
        "germany": "the German",
        "france": "the French",
        "italy": "the Italian",
        "spain": "the Spanish",
        "brazil": "the Brazilian",
        "mexico": "the Mexican",
        "thailand": "the Thai",
        "malaysia": "the Malaysian",
        "indonesia": "the Indonesian",
        "united states": "the US",
        "usa": "the US",
        "canada": "the Canadian",
    }
    return mapping.get(text, "")


def _their_product_ref(site_info: Mapping[str, Any]) -> str:
    weak = {"accessories", "parts", "aftermarket", "4x4", "offroad", "off-road", "vehicle"}
    for product in site_info.get("specific_products", [])[:10]:
        value = lower_text(product)
        if value and value not in weak:
            return value
    return ""


def _join_items(items: list[str]) -> str:
    if not items:
        return "upgrade products"
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{items[0]}, {items[1]}, and {items[2]}"


def subject_for(
    stage: int,
    customer: Any,
    product_info: Mapping[str, Any],
    site_info: Mapping[str, Any] | None,
    variant_index: int,
    task: Mapping[str, Any] | None = None,
) -> str:
    vehicle = normalize(product_info.get("vehicle_model")) or normalize((task or {}).get("vehicle_model")) or "Ford Ranger T9"
    primary = normalize(product_info.get("primary_product")) or "upgrade products"
    angle = normalize(product_info.get("angle")) or "upgrade parts"
    company = _customer_value(customer, "company")
    short_company = company if 0 < len(company) <= 28 else ""
    items = product_info.get("items", [])
    second_item = items[1] if len(items) > 1 else "exterior parts"

    if stage == 2:
        subjects = [
            f"Follow-up: {vehicle} {primary}",
            f"Following up on {vehicle} products",
            f"More {vehicle} product photos for review",
            f"Quick follow-up: {vehicle} {angle}",
            f"{vehicle} {primary} - follow-up",
            f"Following up with a few more {vehicle} photos",
        ]
    elif stage == 3:
        subjects = [
            f"Final quick follow-up on {vehicle} products",
            f"Last follow-up: {vehicle} product suggestion",
            f"Final note about {vehicle} {angle}",
            f"One last follow-up on {vehicle} parts",
        ]
    else:
        subjects = [
            f"{vehicle} {primary} for your range",
            f"{vehicle} upgrade parts - supplier introduction",
            f"{vehicle} {angle} products",
            f"Quick intro - {vehicle} {primary}",
            f"{vehicle} {primary} and {second_item}",
            f"{vehicle} product supply from manufacturer",
            f"Expanding your {vehicle} range?",
            f"{vehicle} exterior parts - looking to connect",
            f"{vehicle} {primary} for {short_company}" if short_company else f"{vehicle} {primary} - direct supply",
        ]
    return subjects[variant_index % len(subjects)]


def build_lines(
    stage: int,
    customer: Any,
    site_info: Mapping[str, Any],
    product_info: Mapping[str, Any],
    variant_index: int,
    task: Mapping[str, Any] | None = None,
) -> dict[str, str]:
    company = _customer_value(customer, "company")
    country = _customer_value(customer, "country")
    ref = _ref_site(customer, site_info)
    direction = normalize(site_info.get("main_direction")) or "vehicle accessories"
    items = list(product_info.get("items", [])) or [normalize(product_info.get("primary_product")) or "upgrade products"]
    item_a = items[0]
    item_b = items[1] if len(items) > 1 else item_a
    item_c = items[2] if len(items) > 2 else ""
    item_text = _join_items(items[:3])
    phrase = normalize(product_info.get("phrase")) or item_text
    primary = normalize(product_info.get("primary_product")) or item_a
    related_text = _join_items([item for item in items if item != primary][:2] or [item_b])
    vehicle = normalize(product_info.get("vehicle_model")) or "Ford Ranger T9"
    region = _region_word(country)
    their_product = _their_product_ref(site_info)
    price_hint = normalize(product_info.get("price_hint"))
    price_line = f" Pricing is around {price_hint}, depending on order details." if price_hint else ""

    if stage == 2:
        followups = [
            {
                "intro": f"I am following up on my previous email about our {vehicle} products.",
                "feature": f"Your website still looks relevant for {direction}, so this time I wanted to focus on {item_a} and {item_b}.",
                "fit_line": "I attached a few more product photos here in case it is easier to review this time.",
                "cta": "If this is of interest, I can send specifications and pricing anytime.",
            },
            {
                "intro": f"Just following up on my earlier message about the {vehicle} range.",
                "feature": f"After checking {ref} again, {primary} looks like one of the closer fits for your product direction.",
                "fit_line": "I included a few extra photos this time for quick reference.",
                "cta": "Let me know if you would like the full details.",
            },
            {
                "intro": f"A quick follow-up from my side on the {vehicle} products I mentioned before.",
                "feature": f"For a business focused on {direction}, {item_text} may be worth a closer look.",
                "fit_line": "The attached photos should make the product direction easier to judge.",
                "cta": "I can send more information if this matches your current range.",
            },
            {
                "intro": "I wanted to follow up in case my previous email was missed.",
                "feature": f"We manufacture {phrase}, with {item_a} as one of the main items for this category.",
                "fit_line": f"Based on {ref}, the fit still looks relevant to me.",
                "cta": "If useful, I can share photos, details, and supply terms.",
            },
        ]
        selected = dict(followups[variant_index % len(followups)])
        selected["greeting"] = greeting(company, variant_index)
        return {key: html.escape(normalize(value), quote=False) for key, value in selected.items()}

    if stage == 3:
        finals = [
            {
                "intro": "Just a final quick follow-up in case my previous emails were missed.",
                "feature": "",
                "fit_line": f"We supply {phrase} that may fit your range.",
                "cta": "If this could be relevant, I can send details anytime.",
            },
            {
                "intro": "One last short note from my side.",
                "feature": "",
                "fit_line": f"Our {vehicle} products cover {item_text}, aimed at exterior and accessory upgrades.",
                "cta": "Happy to send information later if useful.",
            },
            {
                "intro": "A brief final follow-up before I close this on my side.",
                "feature": "",
                "fit_line": f"Your website still looks close to {direction}, so I wanted to leave the option open.",
                "cta": "If you want to review the products, I can send details anytime.",
            },
        ]
        selected = dict(finals[variant_index % len(finals)])
        selected["greeting"] = greeting(company, variant_index)
        return {key: html.escape(normalize(value), quote=False) for key, value in selected.items()}

    shape = variant_index % 12
    if shape == 0:
        intro = f"I noticed {ref} and your focus on {direction}."
        feature = f"We manufacture {phrase}, including {item_text}.{price_line}"
        fit = "That seemed close enough to your current range to make a short introduction."
        cta = "If useful, I can send more photos and product details."
    elif shape == 1:
        question = "Are you currently adding more Ranger-specific products?" if product_info.get("ranger_focus") else f"Are you looking at any new {vehicle} products for your range?"
        intro = question
        feature = f"Our line includes {item_text}, all supplied factory-direct from China.{price_line}"
        fit = f"Given your focus on {direction}, I thought there might be a fit."
        cta = "Would you be open to taking a quick look at photos and specs?"
    elif shape == 2:
        intro = f"{vehicle} accessories are getting strong attention in the pickup market, and {ref} seems active in {direction}."
        feature = f"The products I wanted to introduce are {item_text}, with a focus on {product_info.get('angle', 'practical upgrade value')}.{price_line}"
        fit = "We work with shops and distributors that need clear photos, stable quality, and reasonable lead times."
        cta = "I can share our latest product photos if you would like to review them."
    elif shape == 3:
        intro = f"We make {vehicle} {item_text} factory-direct from China."
        feature = ""
        fit = f"Your range at {ref} looks like it could be a good match."
        cta = "I can send photos and pricing right away if relevant."
    elif shape == 4:
        intro = f"I wanted to introduce our {vehicle} {primary}; it is one of the products we are currently promoting for this model."
        feature = f"The range can also include {related_text}, depending on what fits your market best.{price_line}"
        fit = f"Looking at {ref}, these products could complement your existing {direction} offer."
        cta = "If interested, I can send detailed photos and specs for review."
    elif shape == 5:
        brand_line = ""
        brands = product_info.get("customer_brands", [])
        if brands:
            brand_line = f" I also noticed {str(brands[0]).title()} and related vehicle signals on your site."
        intro = f"We are a manufacturer of {vehicle} exterior and accessory parts based in Changzhou, China.{brand_line}"
        feature = f"Our current lineup includes {item_text}, with production handled in our own facility."
        fit = "We are looking for suitable dealers and distributors in relevant markets."
        cta = "Should I send the product sheet first for your review?"
    elif shape == 6:
        intro = f"We have been supplying pickup accessory businesses in {region + ' market' if region else 'several markets'} with {vehicle} upgrade products."
        add_on = f" {item_c} can also work as an add-on." if item_c else ""
        feature = f"The main products for this direction are {item_a} and {item_b}.{add_on}"
        fit = f"I noticed {ref} and thought the overlap with {direction} was clear enough to contact you."
        cta = "I would be glad to send photos and hear whether this fits your range."
    elif shape == 7:
        intro = f"Demand for stronger {vehicle} exterior upgrades seems to be growing {('in ' + region + ' market') if region else 'in many pickup markets'}."
        feature = f"We supply {item_text}, all positioned as straightforward upgrade products for shops and distributors.{price_line}"
        fit = f"Since {ref} is already active in {direction}, I thought this product direction may be useful."
        cta = "Would you like me to send the product range and pricing?"
    elif shape == 8:
        intro = f"Reliable sourcing for {vehicle} exterior parts can be difficult when fitment and finish need to stay consistent."
        feature = f"We manufacture {item_text} ourselves, so we can control quality and supply more steadily."
        fit = f"That sourcing angle looked relevant for a business like {ref}."
        cta = "I can send close-up photos so you can judge the quality."
    elif shape == 9:
        intro = f"Quick note: we are promoting several {vehicle} products now, especially {primary}."
        feature = f"The related range includes {related_text}, so it can be presented as a small upgrade package."
        fit = f"I thought {ref} might be interested because of your focus on {direction}."
        cta = "I can send photos and specs if you want to evaluate them."
    elif shape == 10:
        intro = f"Hope you do not mind me reaching out; I came across {ref} and wanted to introduce what we make."
        feature = f"We produce {vehicle} {item_text}. Factory-direct, compact product range, and suitable for accessory sellers."
        fit = f"It looks like it could sit naturally with your {direction} products."
        cta = "No pressure; just let me know if photos or pricing would help."
    else:
        their_line = f"I saw signals around {their_product} on your site, which is why I thought this might be relevant." if their_product else f"Your site looks connected with {direction}, which is why I thought this might be relevant."
        intro = their_line
        feature = f"Our {vehicle} range covers {item_text}, focused on {product_info.get('angle', 'practical exterior upgrade value')}.{price_line}"
        fit = "The goal is to offer products that are easy for dealers to present and customers to understand."
        cta = "If this fits your direction, I can send more information anytime."

    lines = {
        "greeting": greeting(company, variant_index),
        "intro": intro,
        "feature": feature,
        "fit_line": fit,
        "cta": cta,
    }
    return {key: html.escape(normalize(value), quote=False) for key, value in lines.items()}
