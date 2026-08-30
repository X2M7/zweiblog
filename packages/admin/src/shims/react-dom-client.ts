import ReactDOM from 'react-dom';
import type { ReactElement } from 'react';

/** React 17-compatible shape for dependencies that conditionally load the React 18 entry. */
export function createRoot(container: Element | DocumentFragment) {
  return {
    render(node: ReactElement) {
      ReactDOM.render(node, container as Element);
    },
    unmount() {
      ReactDOM.unmountComponentAtNode(container as Element);
    },
  };
}
