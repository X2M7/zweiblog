import { Button, message } from 'antd';

import { getClipboardContents } from '@/services/zwei-blog/clipboard';
import {
  getUploadErrorFromUnknown,
  requireSuccessfulUpload,
} from '@/components/UploadBtn/uploadResponse';
import {
  UploadActivityTracker,
  useUploadActivityTracker,
} from '@/components/UploadBtn/uploadActivity';

export interface CopyUploadBtnProps {
  url: string;
  accept: string;
  text: string;
  setLoading: (loading: boolean) => void;
  activity?: UploadActivityTracker;
  loading?: boolean;
  onFinish: (data: { src: string; isNew: boolean }) => void;
  onError: () => void;
}

export default function (props: CopyUploadBtnProps) {
  const localActivity = useUploadActivityTracker(props.setLoading);
  const activity = props.activity || localActivity;

  const handleClick = async () => {
    if (props.loading) return;
    const releaseUpload = activity.start();
    let fileObj: File | undefined;
    try {
      try {
        fileObj = await getClipboardContents();
      } catch {
        props.onError();
        return;
      }

      if (!fileObj) {
        props.onError();
        return;
      }
      const formData = new FormData();
      formData.append('file', fileObj);

      const response = await fetch(props.url, {
        method: 'POST',
        headers: {
          token: localStorage.getItem('token') || 'null',
        },
        body: formData,
      });
      const { data } = await requireSuccessfulUpload(response);
      props.onFinish(data as { src: string; isNew: boolean });
    } catch (error) {
      message.error(getUploadErrorFromUnknown(error, fileObj?.name || 'clipboard-image'));
    } finally {
      releaseUpload();
    }
  };

  return (
    <div>
      <Button onClick={handleClick} type="primary" loading={props.loading} disabled={props.loading}>
        {props.text}
      </Button>
    </div>
  );
}
