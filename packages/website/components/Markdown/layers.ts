import type { BytemdPlugin } from 'bytemd';
import type { Language } from '../../utils/siteLanguage';

// Enhance sanitized Markdown images; without JavaScript all layers remain readable.
export function Layers(language: Language = 'zh'): BytemdPlugin {
  return {
    viewerEffect: ({ markdownBody }) => {
      const cleanups: Array<() => void> = [];
      markdownBody.querySelectorAll<HTMLElement>('.layer-viewer').forEach(viewer => {
        const panels = Array.from(viewer.children).filter((child): child is HTMLElement =>
          child instanceof HTMLElement && child.tagName === 'P' &&
          child.children.length === 1 && child.firstElementChild?.tagName === 'IMG' &&
          !child.textContent?.trim(),
        );
        if (panels.length < 2) return;
        const controls = document.createElement('div');
        controls.className = 'layer-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', language === 'en' ? 'Select layer' : '选择图层');
        const buttons = panels.map((panel, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = panel.querySelector('img')?.alt ||
            (language === 'en' ? `Layer ${index + 1}` : `图层 ${index + 1}`);
          button.setAttribute('aria-pressed', String(index === 0));
          panel.hidden = index !== 0;
          panel.classList.add('layer-panel');
          controls.append(button);
          return button;
        });
        const select = (event: Event) => {
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          panels.forEach((panel, i) => {
            panel.hidden = i !== index;
            buttons[i].setAttribute('aria-pressed', String(i === index));
          });
        };
        controls.addEventListener('click', select);
        viewer.prepend(controls);
        cleanups.push(() => {
          controls.removeEventListener('click', select);
          controls.remove();
          panels.forEach(panel => {
            panel.hidden = false;
            panel.classList.remove('layer-panel');
          });
        });
      });
      return () => cleanups.forEach(cleanup => cleanup());
    },
  };
}
