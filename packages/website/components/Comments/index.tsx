import dynamic from 'next/dynamic';

const Core = dynamic(() => import('./core'), { ssr: false });

export default function Comments(props: {
  enable: 'true' | 'false';
  visible: boolean;
}) {
  if (!props.enable || props.enable === 'false') return null;
  return <Core enable={props.enable} visible={props.visible} />;
}
