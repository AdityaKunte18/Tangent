void WrappedOpenGL::UseUnusedSupportedFunction(const char *name)
{
  // if this is the first time an unused function is called, remove all frame capturers immediately
  if(m_UnsupportedFunctions.empty())
  {
    for(auto it = m_ContextData.begin(); it != m_ContextData.end(); ++it)
    {
      if(it->second.Modern())
      {
        RenderDoc::Inst().RemoveDeviceFrameCapturer(it->second.ctx);
        for(auto wnd = it->second.windows.begin(); wnd != it->second.windows.end();)
        {
          void *wndHandle = wnd->first;
          wnd++;
          it->second.UnassociateWindow(this, wndHandle);
        }
      }
    }
  }

  size_t sz = m_UnsupportedFunctions.size();
  m_UnsupportedFunctions.insert(name);

  if(sz != m_UnsupportedFunctions.size())
  {
    RDCERR("Unsupported function %s used", name);

    rdcstr unsupportedStatus = StringFormat::Fmt(
        "Unsupported %s used:\n", m_UnsupportedFunctions.size() == 1 ? "function" : "functions");
    size_t i = 0;
    for(const char *func : m_UnsupportedFunctions)
    {
      i++;
      if(i > 4)
        break;
      unsupportedStatus += StringFormat::Fmt(" - %s\n", func);
    }
    if(m_UnsupportedFunctions.size() > i)
      unsupportedStatus += " - ...\n";

    RenderDoc::Inst().SetDriverUnsupportedMessage(RDCDriver::OpenGL, unsupportedStatus);
  }
}

//https://github.com/baldurk/renderdoc/blob/v1.x/renderdoc/driver/gl/gl_driver.cpp