import { Button, message, Upload } from 'antd';
import ImgCrop from 'antd-img-crop';
import { RcFile } from 'antd/lib/upload';
import { useRef } from 'react';
import {
  UploadActivityTracker,
  trackUploadLifecycle,
  useUploadActivityTracker,
} from './uploadActivity';
import {
  buildUploadUrl,
  fitEntireImageCropProps,
  getUploadErrorFromUnknown,
  getUploadErrorMessage,
  isSuccessfulUpload,
  requireSuccessfulUpload,
} from './uploadResponse';
export default function (props: {
  setLoading: (loading: boolean) => void;
  text: string;
  onFinish?: Function;
  onStart?: (file: RcFile) => void;
  activity?: UploadActivityTracker;
  url: string;
  accept: string;
  muti: boolean;
  crop?: boolean;
  folder?: boolean;
  customUpload?: boolean;
  basePath?: string | undefined;
  loading?: boolean;
  plainText?: boolean;
}) {
  const localActivity = useUploadActivityTracker(props.setLoading);
  const activity = props.activity || localActivity;
  const activeUploads = useRef(new Map<string, () => void>());

  const upload = (file: RcFile, rPath: string) => {
    const formData = new FormData();
    let fileName = rPath || file.name;
    if (!props.folder && props.basePath) {
      fileName = `${props.basePath}/${file.name}`;
    }
    formData.append('file', file, fileName);
    const releaseUpload = activity.start();
    props.onStart?.(file);
    fetch(buildUploadUrl(props.url, fileName), {
      method: 'POST',
      body: formData,
      headers: {
        token: (() => {
          return window.localStorage.getItem('token') || 'null';
        })(),
      },
    })
      .then(requireSuccessfulUpload)
      .then((response) => {
        props.onFinish?.(file, file.name, response);
      })
      .catch((error) => {
        message.error(getUploadErrorFromUnknown(error, file.name));
      })
      .finally(() => {
        releaseUpload();
      });
  };
  const Core = (
    <Upload
      showUploadList={false}
      disabled={props.loading}
      // name="file"
      multiple={props.muti}
      accept={props.accept}
      action={props.url}
      directory={props.folder}
      beforeUpload={
        props.customUpload
          ? (file, fileList) => {
              let rPath = file.webkitRelativePath;
              if (rPath && rPath.split('/').length >= 2) {
                rPath = rPath.split('/').slice(1).join('/');
              }
              upload(file, rPath);
              return false;
            }
          : undefined
      }
      headers={{
        token: (() => {
          return window.localStorage.getItem('token') || 'null';
        })(),
      }}
      onChange={(info) => {
        if (props.customUpload) return;

        const lifecycle = trackUploadLifecycle(
          activeUploads.current,
          activity,
          info.file,
          info.file.status,
        );
        if (lifecycle === 'started') props.onStart?.(info.file as RcFile);
        if (info.file.status !== 'uploading') {
          // console.log(info.file, info.fileList);
        }
        if (info.file.status === 'done' || info.file.status === 'success') {
          if (isSuccessfulUpload(info.file.response)) {
            props.onFinish?.(info.file);
          } else {
            message.error(getUploadErrorMessage(info.file.name, 200, info.file.response));
          }
        } else if (info.file.status === 'error') {
          message.error(
            getUploadErrorMessage(info.file.name, info.file.xhr?.status, info.file.response),
          );
        }
      }}
    >
      {props.plainText ? (
        props.text
      ) : (
        <Button type="primary" loading={props.loading} disabled={props.loading}>
          {props.text}
        </Button>
      )}
    </Upload>
  );
  if (props.crop) {
    return <ImgCrop {...fitEntireImageCropProps}>{Core}</ImgCrop>;
  } else {
    return Core;
  }
}
