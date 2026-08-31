import { Button, message, Upload } from 'antd';
import ImgCrop from 'antd-img-crop';
import { RcFile } from 'antd/lib/upload';
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
  onFinish: Function;
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
  const upload = (file: RcFile, rPath: string) => {
    const formData = new FormData();
    let fileName = rPath || file.name;
    if (!props.folder && props.basePath) {
      fileName = `${props.basePath}/${file.name}`;
    }
    formData.append('file', file, fileName);
    props.setLoading(true);
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
        props?.onFinish(file, file.name, response);
      })
      .catch((error) => {
        message.error(getUploadErrorFromUnknown(error, file.name));
      })
      .finally(() => {
        props.setLoading(false);
      });
  };
  const Core = (
    <Upload
      showUploadList={false}
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
        props?.setLoading(true);
        if (info.file.status !== 'uploading') {
          // console.log(info.file, info.fileList);
        }
        if (info.file.status === 'done') {
          props?.setLoading(false);
          if (isSuccessfulUpload(info.file.response)) {
            props?.onFinish(info.file);
          } else {
            message.error(getUploadErrorMessage(info.file.name, 200, info.file.response));
          }
        } else if (info.file.status === 'error') {
          message.error(
            getUploadErrorMessage(info.file.name, info.file.xhr?.status, info.file.response),
          );
          props?.setLoading(false);
        }
      }}
    >
      {props.plainText ? (
        props.text
      ) : (
        <Button type="primary" loading={props.loading}>
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
