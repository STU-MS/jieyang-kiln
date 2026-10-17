const stroke = '#3A332C'

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

export const iconSvg: Record<string, string> = {
  'icon.place.vent': svg('<path d="M6 22h20"/><path d="M8 22c2-8 14-8 16 0"/><path d="M16 8v4"/>'),
  'icon.place.shade': svg('<path d="M8 20c0-6 16-6 16 0"/><path d="M6 20h20"/><path d="M16 8v3"/>'),
  'icon.place.sun': svg('<circle cx="16" cy="16" r="5"/><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7 7l2 2M23 23l2 2M25 7l-2 2M9 23l-2 2"/>'),
  'icon.action.flip': svg('<path d="M8 12h10a6 6 0 0 1 0 12H12"/><path d="M8 12l4-4M8 12l4 4"/>'),
  'icon.action.cover': svg('<path d="M6 14h20v8H6z"/><path d="M6 14c2-4 18-4 20 0"/>'),
  'icon.action.cloth': svg('<path d="M7 10h18l-2 14H9z"/><path d="M11 10c1 4 9 4 10 0"/>'),
  'icon.action.rack': svg('<path d="M8 26V8M24 26V8M8 14h16M8 20h16"/><path d="M12 14v6M20 14v6"/>'),
  'icon.action.fan': svg('<circle cx="16" cy="16" r="2"/><path d="M16 14c-6-8-10 2-2 4M18 16c8-6-2-10-4-2M16 18c6 8 10-2 2-4M14 16C6 22 16 26 18 18"/>'),
  'icon.action.cotton': svg('<path d="M8 18c0-5 16-5 16 0v6H8z"/><path d="M10 18c1-3 11-3 12 0"/>'),
  'icon.action.damper': svg('<path d="M8 8h16v16H8z"/><path d="M8 16h16M16 8v16"/>'),
  'icon.weather.sunny': svg('<circle cx="16" cy="16" r="4"/><path d="M16 6v3M16 23v3M6 16h3M23 16h3M8 8l2 2M22 22l2 2M24 8l-2 2M10 22l-2 2"/>'),
  'icon.weather.cloudy': svg('<path d="M10 22h12a5 5 0 0 0 0-10 6 6 0 0 0-11-1A4 4 0 0 0 10 22z"/>'),
  'icon.weather.overcast': svg('<path d="M8 20h16a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4 4 0 0 0-7 2 3 3 0 0 0 0 7z"/>'),
  'icon.weather.rain': svg('<path d="M9 16h12a4 4 0 0 0 .5-8 5 5 0 0 0-9.5-.5A4 4 0 0 0 9 16z"/><path d="M12 20l-1 4M16 20l-1 4M20 20l-1 4"/>'),
  'icon.weather.returningSouth': svg('<path d="M8 20h14a4 4 0 0 0 0-8 5 5 0 0 0-9 0"/><path d="M8 24c2 2 4 2 6 0M16 24c2 2 4 2 6 0"/>'),
  'icon.weather.coldAir': svg('<path d="M6 16h20M16 6v20M9 9l14 14M23 9L9 23"/>'),
  'icon.lock': svg('<rect x="8" y="14" width="16" height="12" rx="2"/><path d="M11 14.5V10.5a5 5 0 0 1 10 0v4"/><path d="M16 18.2v3.2"/>'),
}
