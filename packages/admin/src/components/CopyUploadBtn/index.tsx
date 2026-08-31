import { Button, message } from 'antd';

import { getClipboardContents } from '@/services/zwei-blog/clipboard';
import {
  getUploadErrorFromUnknown,
  requireSuccessfulUpload,
} from '@/components/UploadBtn/uploadResponse';

export interface CopyUploadBtnProps {
  url: string;
  accept: string;
  text: string;
  setLoading: (loading: boolean) => void;
  onFinish: (data: { src: string; isNew: boolean }) => void;
  onError: () => void;
}

export default function (props: CopyUploadBtnProps) {
  const handleClick = async () => {
    props.setLoading(true);

    const fileObj = await getClipboardContents();

    if (!fileObj) {
      props.setLoading(false);
      props.onError();
      return;
    }
    const formData = new FormData();

    formData.append('file', fileObj);

    return fetch(props.url, {
      method: 'POST',
      headers: {
        token: localStorage.getItem('token') || 'null',
      },
      body: formData,
    })
      .then(requireSuccessfulUpload)
      .then(({ data }) => {
        props?.onFinish(data as { src: string; isNew: boolean });
      })
      .catch((error) => {
        message.error(getUploadErrorFromUnknown(error, fileObj.name));
      })
      .finally(() => {
        props.setLoading(false);
      });
  };

  return (
    <div>
      <Button onClick={handleClick} type="primary">
        {props.text}
      </Button>
    </div>
  );
}
